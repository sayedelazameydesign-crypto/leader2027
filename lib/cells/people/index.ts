/**
 * نواة الأشخاص — `people`
 *
 * الركن: سجل الأشخاص (وعي بالمصدر).
 * تعيد استخدام خدمات النطاق المُختبَرة **بلا تغيير**: الصلاحيات والتحقق و§5
 * وكتابة التدقيق كلها كما هي — فالسلوك عبر النواة = السلوك عبر HTTP بالحرف.
 */
import { defineCell, type Actor } from "@/lib/kernel/types";
import { repos, numberSlot, stringSlot, toDomainActor, ToolFailure } from "@/lib/kernel/bridge";
import { can } from "@/lib/authorization/policy";
import { createPerson, getPerson, listPeople, updatePerson } from "@/lib/domain/people/service";
import type { Person } from "@/lib/domain/people/person";

export type PeopleReader = {
  list(actor: Actor): Person[];
  get(actor: Actor, id: string): Person;
};

export type PeopleWriter = {
  create(actor: Actor, input: unknown): Person;
  update(actor: Actor, id: string, patch: unknown): Person;
};

/** يحوّل نتيجة خدمة النطاق إلى قيمة أو يرمي فشلًا صريحًا للأداة. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; status: number; errors: Record<string, string> }): T {
  if (result.ok) return result.value;
  const message = Object.values(result.errors).join(" · ") || "فشل غير محدَّد";
  throw new ToolFailure(`domain.${result.status}`, message);
}

const peopleCell = defineCell({
  manifest: {
    id: "people",
    version: "1.0.0",
    title: { ar: "نواة الأشخاص", en: "People Nucleus" },
    corner: "سجل الأشخاص",
    summary: {
      ar: "قراءة وإنشاء وتعديل الأشخاص — وعي بالمصدر، وبلا أي حقل تفضيل سياسي (§5).",
      en: "Read, create, and update people — source-aware, with no political-preference field (§5).",
    },
    provides: ["people.read", "people.write"],
    requires: ["auth.session", "audit.trail"],
    emits: ["people.created", "people.updated"],
    consumes: [],
    config: [
      {
        key: "default_source",
        label: { ar: "المصدر الافتراضي", en: "Default source" },
        default: "ميداني",
        effect: {
          ar: "يُستخدم عند غياب `source` في الطلب — قِيَم المصدر تبقى نصية ولا تُصنَّف سياسيًا.",
          en: "Used when the request omits `source` — source stays descriptive text, never political classification.",
        },
      },
      {
        key: "list_limit",
        label: { ar: "حد القائمة", en: "List limit" },
        default: 100,
        effect: {
          ar: "أقصى عدد أشخاص يُعيده `people.list` في نداء واحد (1-500).",
          en: "Maximum people returned by `people.list` in one call (1-500).",
        },
      },
      {
        key: "allow_agent_create",
        label: { ar: "السماح بإنشاء الوكيل", en: "Allow agent creation" },
        default: true,
        effect: {
          ar: "عند التعطيل يُرفض إنشاء شخص من وكيل حتى مع موافقة بشرية — الركن محجوز للبشر.",
          en: "When disabled, agent-initiated creation is refused even with human approval — the corner is reserved for humans.",
        },
      },
    ],
    tools: [
      {
        name: "people.list",
        label: { ar: "قائمة الأشخاص", en: "List people" },
        capability: "people.read",
        risk: "read",
        input: { limit: "number" },
        requiresApprovalForAgents: false,
      },
      {
        name: "people.get",
        label: { ar: "شخص واحد", en: "Get person" },
        capability: "people.read",
        risk: "read",
        input: { id: "string" },
        requiresApprovalForAgents: false,
      },
      {
        name: "people.create",
        label: { ar: "إنشاء شخص", en: "Create person" },
        capability: "people.write",
        risk: "write",
        input: { full_name: "string", phone: "string", region_id: "string", source: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "people.update",
        label: { ar: "تعديل شخص", en: "Update person" },
        capability: "people.write",
        risk: "write",
        input: { id: "string", full_name: "string", phone: "string", region_id: "string", source: "string" },
        requiresApprovalForAgents: true,
      },
    ],
  },

  services: {
    "people.read": {
      list(actor: Actor): Person[] {
        const domainActor = toDomainActor(actor);
        if (!can(domainActor, "people:view")) {
          throw new ToolFailure("forbidden", "لا تملك صلاحية `people:view`");
        }
        return listPeople(domainActor, repos());
      },
      get(actor: Actor, id: string): Person {
        return unwrap(getPerson(toDomainActor(actor), id, repos()));
      },
    } satisfies PeopleReader,

    "people.write": {
      create(actor: Actor, input: unknown): Person {
        return unwrap(createPerson(toDomainActor(actor), input, repos()));
      },
      update(actor: Actor, id: string, patch: unknown): Person {
        return unwrap(updatePerson(toDomainActor(actor), id, patch, repos()));
      },
    } satisfies PeopleWriter,
  },

  tools: {
    "people.list": (ctx) => {
      const reader = ctx.require<PeopleReader>("people.read");
      const limit = numberSlot(ctx.config.list_limit, 100, 1, 500);
      const items = reader.list(ctx.actor);
      return { count: items.length, limit, items: items.slice(0, limit) };
    },

    "people.get": (ctx) => {
      const reader = ctx.require<PeopleReader>("people.read");
      return reader.get(ctx.actor, String(ctx.input.id ?? ""));
    },

    "people.create": (ctx) => {
      if (ctx.actor.kind === "agent" && ctx.config.allow_agent_create !== true) {
        throw new ToolFailure("people.agent_blocked", "إنشاء الأشخاص محجوز للبشر في هذا الركن");
      }
      const writer = ctx.require<PeopleWriter>("people.write");
      const input = { ...(ctx.input as Record<string, unknown>) };

      // مَقبض: المصدر الافتراضي لهذا الركن وحده
      if (input.source === undefined || input.source === "") {
        input.source = stringSlot(ctx.config.default_source, "ميداني", 60);
      }

      const person = writer.create(ctx.actor, input);
      ctx.emit("people.created", { person_id: person.id, region_id: person.region_id });
      return person;
    },

    "people.update": (ctx) => {
      const writer = ctx.require<PeopleWriter>("people.write");
      const { id, ...patch } = ctx.input as Record<string, unknown>;
      const person = writer.update(ctx.actor, String(id ?? ""), patch);
      ctx.emit("people.updated", { person_id: person.id });
      return person;
    },
  },

  health() {
    try {
      const count = repos().people.list().length;
      return { ok: true, detail: `المخزن متاح — ${count} شخصًا`, at: new Date().toISOString() };
    } catch (err) {
      return {
        ok: false,
        detail: `تعذّر الوصول للمخزن: ${err instanceof Error ? err.message : String(err)}`,
        at: new Date().toISOString(),
      };
    }
  },
});

export { peopleCell };
