/**
 * نواة التدقيق — `audit`
 *
 * الركن: سجل التدقيق.
 * تُشبع `audit.trail` التي **تحتاجها كل نواة تكتب**، فتصير هي أساس النظام كله.
 *
 * ملاحظة معمارية: النوى لا تتخاطب عبر الناقل للتدقيق — التدقيق **متزامن ومضمون**
 * (عقد المنتج: كل تغيير ينشئ حدث تدقيق). الناقل هنا مخصَّص لأحداث النواة نفسها
 * (تركيب/استبدال/إعدادات/موافقات) حتى لا يتضاعف التسجيل.
 */
import { defineCell, type KernelEvent } from "@/lib/kernel/types";
import { repos, toDomainActor } from "@/lib/kernel/bridge";
import { recordAudit } from "@/lib/audit/audit";
import { can } from "@/lib/authorization/policy";
import type { AuditEvent } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/kernel/types";

/** واجهة سجل التدقيق — ما تعتمد عليه بقية الأنوية. */
export type AuditTrail = {
  record(entry: {
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string;
    meta?: Record<string, string | number>;
  }): AuditEvent;
  count(): number;
};

/** قراءة السجل — مقيَّدة بإجراء `audit:view` في مصفوفة الصلاحيات. */
export type AuditReader = {
  list(actor: Actor, limit?: number): AuditEvent[];
};

const auditCell = defineCell({
  manifest: {
    id: "audit",
    version: "1.0.0",
    title: { ar: "نواة التدقيق", en: "Audit Nucleus" },
    corner: "سجل التدقيق",
    summary: {
      ar: "تسجل كل تغيير في النظام وتقرأ السجل بصلاحية صريحة.",
      en: "Records every mutation in the system and reads it back under an explicit permission.",
    },
    provides: ["audit.trail", "audit.read"],
    requires: [],
    emits: [],
    consumes: [
      "kernel.cell.mounted",
      "kernel.cell.swapped",
      "kernel.cell.unmounted",
      "kernel.cell.failed",
      "kernel.config.changed",
      "kernel.config.reset",
      "kernel.approval.requested",
      "kernel.call.rejected",
    ],
    config: [
      {
        key: "read_limit",
        label: { ar: "حد القراءة الافتراضي", en: "Default read limit" },
        default: 100,
        effect: {
          ar: "أقصى عدد أحداث يُعيدها `audit.list` عند غياب حد صريح.",
          en: "Maximum events returned by `audit.list` when no explicit limit is given.",
        },
      },
      {
        key: "fail_closed",
        label: { ar: "الفشل مُغلقًا", en: "Fail closed" },
        default: true,
        effect: {
          ar: "عند تعذّر الكتابة في المخزن يُرفض الطلب بدل المتابعة بلا أثر تدقيقي.",
          en: "When the store cannot be written, the request is refused instead of proceeding untraced.",
        },
      },
    ],
    tools: [
      {
        name: "audit.list",
        label: { ar: "قراءة سجل التدقيق", en: "Read audit trail" },
        capability: "audit.read",
        risk: "read",
        input: { limit: "number" },
        requiresApprovalForAgents: false,
      },
    ],
  },

  services: {
    "audit.trail": {
      record(entry: {
        actor: Actor;
        action: string;
        entityType: string;
        entityId: string;
        meta?: Record<string, string | number>;
      }): AuditEvent {
        return recordAudit(
          repos(),
          toDomainActor(entry.actor),
          entry.action,
          entry.entityType,
          entry.entityId,
          entry.meta,
        );
      },
      count(): number {
        return repos().audit.list().length;
      },
    } satisfies AuditTrail,

    "audit.read": {
      list(actor: Actor, limit?: number): AuditEvent[] {
        const domainActor = toDomainActor(actor);
        if (!can(domainActor, "audit:view")) return [];
        const all = repos().audit.list();
        return all.slice(Math.max(0, all.length - (limit ?? 100)));
      },
    } satisfies AuditReader,
  },

  tools: {
    "audit.list": (ctx) => {
      const trail = ctx.require<AuditReader>("audit.read");
      const requested = Number(ctx.input.limit ?? ctx.config.read_limit);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), 1000);
      const events = trail.list(ctx.actor, limit);
      if (!can(toDomainActor(ctx.actor), "audit:view")) {
        throw new Error("لا تملك صلاحية `audit:view` لقراءة سجل التدقيق");
      }
      return { count: events.length, events };
    },
  },

  /** أحداث النواة تُدوَّن كأثر تدقيقي نواة — مَن بدّل ماذا ومتى. */
  onEvent(event: KernelEvent, ctx) {
    const trail = ctx.require<AuditTrail>("audit.trail");
    const payload = (event.payload ?? {}) as Record<string, string | number>;
    trail.record({
      actor: { id: "kernel", role: "SYSTEM", kind: "agent" },
      action: event.type,
      entityType: "kernel",
      entityId: String(payload.cell ?? event.source),
      meta: { ...payload, source: event.source },
    });
  },

  health() {
    try {
      const count = repos().audit.list().length;
      return {
        ok: true,
        detail: `المخزن متاح — ${count} حدث تدقيق`,
        at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        detail: `تعذّر الوصول للمخزن: ${err instanceof Error ? err.message : String(err)}`,
        at: new Date().toISOString(),
      };
    }
  },
});

export { auditCell };
