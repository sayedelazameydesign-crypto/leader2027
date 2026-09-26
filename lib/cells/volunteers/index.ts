/**
 * نواة المتطوعين — `volunteers`
 *
 * الركن: دورة حياة المتطوع.
 * **تعتمد على `people.read` لا على استيراد نواة الأشخاص** — إثبات عملي لقاعدة
 * «الأنوية لا تستورد بعضها»: لو حُذفت نواة الأشخاص لصار هذا الركن `blocked`
 * بدل أن ينكسر النظام.
 */
import { defineCell, type Actor } from "@/lib/kernel/types";
import { repos, stringSlot, toDomainActor, ToolFailure } from "@/lib/kernel/bridge";
import { can } from "@/lib/authorization/policy";
import {
  createVolunteer,
  getVolunteer,
  listVolunteers,
  updateVolunteer,
} from "@/lib/domain/volunteers/service";
import type { Volunteer } from "@/lib/domain/volunteers/volunteer";

/**
 * الشكل الذي نحتاجه من قدرة `people.read` — **مُعلَن محليًا ولا يُستورد من نواة
 * الأشخاص**. هكذا يبقى هذا الركن قابلًا للتعديل أو الحذف دون أي أثر على نواة
 * الأشخاص، والعكس صحيح. العقود تُوصف عند المستهلك لا عند المنتِج.
 */
type PeopleLookup = {
  get(actor: Actor, id: string): { id: string };
};

export type VolunteersReader = {
  list(actor: Actor, filter?: { team_id?: string }): Volunteer[];
  get(actor: Actor, id: string): Volunteer;
};

export type VolunteersWriter = {
  create(actor: Actor, input: unknown): Volunteer;
  setStatus(actor: Actor, id: string, status: string): Volunteer;
};

function unwrap<T>(result: { ok: true; value: T } | { ok: false; status: number; errors: Record<string, string> }): T {
  if (result.ok) return result.value;
  const message = Object.values(result.errors).join(" · ") || "فشل غير محدَّد";
  throw new ToolFailure(`domain.${result.status}`, message);
}

const volunteersCell = defineCell({
  manifest: {
    id: "volunteers",
    version: "1.0.0",
    title: { ar: "نواة المتطوعين", en: "Volunteers Nucleus" },
    corner: "دورة حياة المتطوع",
    summary: {
      ar: "تسجيل المتطوعين وتغيير حالتهم، مع التحقق من وجود الشخص عبر قدرة نواة الأشخاص.",
      en: "Registers volunteers and changes their status, resolving the person through the people nucleus's capability.",
    },
    provides: ["volunteers.read", "volunteers.write"],
    requires: ["people.read", "auth.session", "audit.trail"],
    emits: ["volunteers.created", "volunteers.status_changed"],
    consumes: [],
    config: [
      {
        key: "default_status",
        label: { ar: "الحالة الافتراضية", en: "Default status" },
        default: "active",
        effect: {
          ar: "الحالة عند التسجيل: active أو inactive.",
          en: "Status applied on registration: active or inactive.",
        },
      },
      {
        key: "require_team",
        label: { ar: "الفريق إلزامي", en: "Team required" },
        default: false,
        effect: {
          ar: "عند التمكين يُرفض تسجيل متطوع بلا فريق.",
          en: "When enabled, registering a volunteer without a team is refused.",
        },
      },
      {
        key: "list_limit",
        label: { ar: "حد القائمة", en: "List limit" },
        default: 100,
        effect: {
          ar: "أقصى عدد متطوعين يُعيده `volunteers.list` (1-500).",
          en: "Maximum volunteers returned by `volunteers.list` (1-500).",
        },
      },
    ],
    tools: [
      {
        name: "volunteers.list",
        label: { ar: "قائمة المتطوعين", en: "List volunteers" },
        capability: "volunteers.read",
        risk: "read",
        input: { team_id: "string" },
        requiresApprovalForAgents: false,
      },
      {
        name: "volunteers.get",
        label: { ar: "متطوع واحد", en: "Get volunteer" },
        capability: "volunteers.read",
        risk: "read",
        input: { id: "string" },
        requiresApprovalForAgents: false,
      },
      {
        name: "volunteers.create",
        label: { ar: "تسجيل متطوع", en: "Register volunteer" },
        capability: "volunteers.write",
        risk: "write",
        input: { person_id: "string", team_id: "string", status: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "volunteers.set_status",
        label: { ar: "تغيير حالة متطوع", en: "Set volunteer status" },
        capability: "volunteers.write",
        risk: "write",
        input: { id: "string", status: "string" },
        requiresApprovalForAgents: true,
      },
    ],
  },

  services: {
    "volunteers.read": {
      list(actor: Actor, filter?: { team_id?: string }): Volunteer[] {
        const domainActor = toDomainActor(actor);
        if (!can(domainActor, "volunteers:view")) {
          throw new ToolFailure("forbidden", "لا تملك صلاحية `volunteers:view`");
        }
        return listVolunteers(domainActor, repos(), filter);
      },
      get(actor: Actor, id: string): Volunteer {
        return unwrap(getVolunteer(toDomainActor(actor), id, repos()));
      },
    } satisfies VolunteersReader,

    "volunteers.write": {
      create(actor: Actor, input: unknown): Volunteer {
        return unwrap(createVolunteer(toDomainActor(actor), input, repos()));
      },
      setStatus(actor: Actor, id: string, status: string): Volunteer {
        return unwrap(updateVolunteer(toDomainActor(actor), id, { status }, repos()));
      },
    } satisfies VolunteersWriter,
  },

  onMount(ctx) {
    // تحقق مبكر: إن لم تُشبَع قدرة الأشخاص فالتركيب نفسه يفشل (يُعزل الركن)
    // ولا يُسقط بقية النظام — النداء يمرّ عبر القدرة لا عبر استيراد النواة.
    ctx.require<PeopleLookup>("people.read");
  },

  tools: {
    "volunteers.list": (ctx) => {
      const reader = ctx.require<VolunteersReader>("volunteers.read");
      const teamId = ctx.input.team_id ? String(ctx.input.team_id) : undefined;
      const items = reader.list(ctx.actor, teamId ? { team_id: teamId } : undefined);
      const requested = Number(ctx.config.list_limit);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), 500);
      return { count: items.length, limit, items: items.slice(0, limit) };
    },

    "volunteers.get": (ctx) => {
      const reader = ctx.require<VolunteersReader>("volunteers.read");
      return reader.get(ctx.actor, String(ctx.input.id ?? ""));
    },

    "volunteers.create": (ctx) => {
      const writer = ctx.require<VolunteersWriter>("volunteers.write");
      const people = ctx.require<PeopleLookup>("people.read");
      const input = { ...(ctx.input as Record<string, unknown>) };

      // التحقق من الشخص يمرّ عبر **قدرة** نواة الأشخاص — لا استيراد ولا مخزن مباشر
      people.get(ctx.actor, String(input.person_id ?? ""));

      // مَقبض: الحالة الافتراضية لهذا الركن
      if (input.status === undefined || input.status === "") {
        input.status = stringSlot(ctx.config.default_status, "active", 20);
      }
      // مَقبض: إلزامية الفريق
      if (ctx.config.require_team === true && !input.team_id) {
        throw new ToolFailure("volunteers.team_required", "هذا الركن يشترط تحديد فريق للمتطوع");
      }

      const volunteer = writer.create(ctx.actor, input);
      ctx.emit("volunteers.created", {
        volunteer_id: volunteer.id,
        person_id: volunteer.person_id,
        status: volunteer.status,
      });
      return volunteer;
    },

    "volunteers.set_status": (ctx) => {
      const writer = ctx.require<VolunteersWriter>("volunteers.write");
      const volunteer = writer.setStatus(ctx.actor, String(ctx.input.id ?? ""), String(ctx.input.status ?? ""));
      ctx.emit("volunteers.status_changed", {
        volunteer_id: volunteer.id,
        status: volunteer.status,
      });
      return volunteer;
    },
  },

  health() {
    try {
      const total = repos().volunteers.list().length;
      const active = repos().volunteers.list().filter((v) => v.status === "active").length;
      return {
        ok: true,
        detail: `المخزن متاح — ${total} متطوعًا (${active} نشط)`,
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

export { volunteersCell };
