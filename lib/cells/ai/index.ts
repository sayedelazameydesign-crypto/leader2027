/**
 * نواة الوكلاء والموافقات — `ai`
 *
 * الركن: طبقة الذكاء الاصطناعي (2027).
 *
 * هذه هي النواة التي تجعل النظام «يليق بعام 2027»:
 *   - تنشر كتالوج الأدوات للوكلاء (وصف منظَّم قابل للقراءة الآلية).
 *   - تُدير **بوابة الموافقة البشرية**: وكيل لا يكتب بلا تصريح إنسان.
 *   - التصريح **مرة واحدة** (single-use) ومرتبط بأداة بعينها.
 *
 * ملاحظة أمنية مقصودة: أدوات قرار الموافقة نفسها `admin` وتتطلب موافقة للوكلاء —
 * أي أن وكيلًا لا يستطيع اعتماد طلب وكيل آخر بلا إنسان.
 *
 * الوصول إلى السجل والبوابة يمرّ عبر قدرتين مدمجتين (`kernel.registry`,
 * `kernel.approvals`) — لا استيراد للنواة إطلاقًا.
 */
import { defineCell, type Actor, type ApprovalRequest, type MountContext } from "@/lib/kernel/types";
import { numberSlot, toDomainActor, ToolFailure } from "@/lib/kernel/bridge";
import { can } from "@/lib/authorization/policy";

export type ToolView = {
  name: string;
  label: { ar: string; en: string };
  risk: string;
  capability: string;
  cell: string;
  corner: string;
  input: Record<string, string>;
  requiresApprovalForAgents: boolean;
};

export type CellView = { id: string; state: string; corner: string; version: string; tools: string[] };

export type CatalogueService = {
  tools(): ToolView[];
  cells(): CellView[];
};

export type ApprovalsService = {
  pending(): ApprovalRequest[];
  all(limit?: number): ApprovalRequest[];
  grant(id: string, by: string, note?: string, role?: string): ApprovalRequest;
  deny(id: string, by: string, reason: string, role?: string): ApprovalRequest;
};

type RawTool = {
  name: string;
  label: { ar: string; en: string };
  risk: string;
  capability: string;
  requiresApprovalForAgents: boolean;
  input: Record<string, string>;
};

/** الأشكال التي نحتاجها من قدرتي النواة المدمجتين. */
type KernelRegistry = {
  tools(): RawTool[];
  cells(): Array<{ id: string; state: string; corner: string; version: string; tools: string[] }>;
};

type KernelApprovals = {
  pending(): ApprovalRequest[];
  all(limit?: number): ApprovalRequest[];
  grant(id: string, by: string, note?: string, role?: string): ApprovalRequest;
  deny(id: string, by: string, reason: string, role?: string): ApprovalRequest;
};

/** سجل التدقيق — لأثر «مَن فوّض مَن» في سلسلة المساءلة. */
type AuditRecorder = {
  record(entry: {
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string;
    meta?: Record<string, string | number>;
  }): unknown;
};

/** سياق التركيب مُلتقَط مرة واحدة — خدمة القدرة تعمل بعده. */
let bound: MountContext | null = null;

function context(): MountContext {
  if (!bound) throw new ToolFailure("ai.unmounted", "نواة الوكلاء غير مُركَّبة بعد");
  return bound;
}

const catalogue: CatalogueService = {
  tools() {
    const registry = context().require<KernelRegistry>("kernel.registry");
    const cells = registry.cells();
    const cornerOf = new Map(cells.map((c) => [c.id, c.corner]));
    return registry.tools().map((tool) => ({
      name: tool.name,
      label: tool.label,
      risk: tool.risk,
      capability: tool.capability,
      cell: tool.name.split(".")[0],
      corner: cornerOf.get(tool.name.split(".")[0]) ?? "—",
      input: tool.input,
      requiresApprovalForAgents: tool.requiresApprovalForAgents,
    }));
  },
  cells() {
    return context().require<KernelRegistry>("kernel.registry").cells();
  },
};

const approvals: ApprovalsService = {
  pending: () => context().require<KernelApprovals>("kernel.approvals").pending(),
  all: (limit?: number) => context().require<KernelApprovals>("kernel.approvals").all(limit),
  grant: (id, by, note, role) => context().require<KernelApprovals>("kernel.approvals").grant(id, by, note, role),
  deny: (id, by, reason, role) => context().require<KernelApprovals>("kernel.approvals").deny(id, by, reason, role),
};

/** قرار الموافقة مقصور على Manager+ — نفس إجراء إدارة المستخدمين. */
function assertCanDecide(actor: Actor): void {
  if (!can(toDomainActor(actor), "users:manage")) {
    throw new ToolFailure("forbidden", "اعتماد الموافقات مقصور على Manager+ (`users:manage`)");
  }
}

const aiCell = defineCell({
  manifest: {
    id: "ai",
    version: "1.0.0",
    title: { ar: "نواة الوكلاء", en: "Agent Nucleus" },
    corner: "الوكلاء والموافقات البشرية",
    summary: {
      ar: "تنشر كتالوج الأدوات للوكلاء وتدير بوابة الموافقة البشرية قبل أي كتابة.",
      en: "Publishes the tool catalogue for agents and runs the human-approval gate before any write.",
    },
    provides: ["ai.catalogue", "ai.approvals"],
    requires: ["kernel.registry", "kernel.approvals", "audit.trail"],
    emits: ["ai.approval.decided"],
    consumes: ["kernel.approval.requested"],
    config: [
      {
        key: "include_write_tools",
        label: { ar: "إظهار أدوات الكتابة", en: "Include write tools" },
        default: true,
        effect: {
          ar: "عند التعطيل يعرض الكتالوج أدوات القراءة فقط — تقليص سطح التعرض للوكيل بلا تغيير كود.",
          en: "When disabled, the catalogue exposes read-only tools — shrinking the agent's surface without code changes.",
        },
      },
      {
        key: "max_catalogue_size",
        label: { ar: "أقصى حجم للكتالوج", en: "Max catalogue size" },
        default: 200,
        effect: {
          ar: "حد عدد الأدوات المُعادة في نداء واحد (1-1000) — حماية سياق النموذج.",
          en: "Cap on tools returned per call (1-1000) — protects the model's context window.",
        },
      },
      {
        key: "hide_admin_tools",
        label: { ar: "إخفاء أدوات الإدارة", en: "Hide admin tools" },
        default: false,
        effect: {
          ar: "عند التمكين تُستبعَد أدوات مستوى admin من كتالوج الوكلاء (القراءة والكتابة تبقى).",
          en: "When enabled, admin-risk tools are excluded from the agent catalogue (read and write remain).",
        },
      },
    ],
    tools: [
      {
        name: "ai.list_tools",
        label: { ar: "كتالوج الأدوات", en: "Tool catalogue" },
        capability: "ai.catalogue",
        risk: "read",
        input: { include_write: "boolean" },
        requiresApprovalForAgents: false,
      },
      {
        name: "ai.pending_approvals",
        label: { ar: "الموافقات المعلَّقة", en: "Pending approvals" },
        capability: "ai.approvals",
        risk: "read",
        input: {},
        requiresApprovalForAgents: false,
      },
      {
        name: "ai.grant_approval",
        label: { ar: "منح موافقة", en: "Grant approval" },
        capability: "ai.approvals",
        risk: "admin",
        input: { approval_id: "string", note: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "ai.deny_approval",
        label: { ar: "رفض موافقة", en: "Deny approval" },
        capability: "ai.approvals",
        risk: "admin",
        input: { approval_id: "string", reason: "string" },
        requiresApprovalForAgents: true,
      },
    ],
  },

  services: {
    "ai.catalogue": catalogue,
    "ai.approvals": approvals,
  },

  onMount(ctx) {
    bound = ctx;
    ctx.require<KernelRegistry>("kernel.registry");
    ctx.require<KernelApprovals>("kernel.approvals");
  },

  onUnmount() {
    bound = null;
  },

  onEvent(event, ctx) {
    const payload = (event.payload ?? {}) as Record<string, string>;
    ctx.emit("ai.approval.requested", {
      approval_id: String(payload.approvalId ?? ""),
      tool: String(payload.tool ?? ""),
      cell: String(payload.cell ?? ""),
    });
  },

  tools: {
    "ai.list_tools": (ctx) => {
      const includeWrite = ctx.input.include_write ?? ctx.config.include_write_tools;
      const hideAdmin = ctx.config.hide_admin_tools === true;
      const max = numberSlot(ctx.config.max_catalogue_size, 200, 1, 1000);

      let items = catalogue.tools();
      if (includeWrite === false) items = items.filter((t) => t.risk === "read");
      if (hideAdmin) items = items.filter((t) => t.risk !== "admin");

      return {
        total: items.length,
        count: Math.min(items.length, max),
        cells: catalogue.cells().map((c) => ({ id: c.id, state: c.state, corner: c.corner })),
        tools: items.slice(0, max),
      };
    },

    "ai.pending_approvals": () => {
      const pending = approvals.pending();
      return { count: pending.length, requests: pending };
    },

    "ai.grant_approval": (ctx) => {
      assertCanDecide(ctx.actor);
      const request = approvals.grant(
        String(ctx.input.approval_id ?? ""),
        ctx.actor.id,
        ctx.input.note ? String(ctx.input.note) : undefined,
        ctx.actor.role,
      );
      // سلسلة المساءلة: مَن فوّض ماذا ولمن — تُكتب في سجل التدقيق نفسه
      ctx
        .require<AuditRecorder>("audit.trail")
        .record({
          actor: ctx.actor,
          action: "ai.approval.granted",
          entityType: "approval",
          entityId: request.id,
          meta: { tool: request.tool, cell: request.cell, agent: request.actor, role: ctx.actor.role },
        });
      ctx.emit("ai.approval.decided", { approval_id: request.id, state: request.state, by: ctx.actor.id });
      return request;
    },

    "ai.deny_approval": (ctx) => {
      assertCanDecide(ctx.actor);
      const request = approvals.deny(
        String(ctx.input.approval_id ?? ""),
        ctx.actor.id,
        String(ctx.input.reason ?? "بلا سبب مُسجَّل"),
        ctx.actor.role,
      );
      ctx
        .require<AuditRecorder>("audit.trail")
        .record({
          actor: ctx.actor,
          action: "ai.approval.denied",
          entityType: "approval",
          entityId: request.id,
          meta: { tool: request.tool, cell: request.cell, agent: request.actor, role: ctx.actor.role },
        });
      ctx.emit("ai.approval.decided", { approval_id: request.id, state: request.state, by: ctx.actor.id });
      return request;
    },
  },

  health() {
    if (!bound) {
      return { ok: false, detail: "غير مُركَّبة", at: new Date().toISOString() };
    }
    try {
      const pending = approvals.pending().length;
      const tools = catalogue.tools().length;
      return {
        ok: true,
        detail: `الكتالوج: ${tools} أداة · الموافقات المعلَّقة: ${pending}`,
        at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
    }
  },
});

export { aiCell };
