/**
 * نواة إعدادات الحملة — `settings`
 *
 * الركن: الحملة والدورات والمناطق والفرق.
 * كل الأوامر هنا محكومة بإجراء `settings:manage` القائم — لا مصفوفة صلاحيات جديدة.
 */
import { defineCell, type Actor } from "@/lib/kernel/types";
import { repos, numberSlot, stringSlot, toDomainActor, ToolFailure } from "@/lib/kernel/bridge";
import { can } from "@/lib/authorization/policy";
import {
  createCycle,
  createRegion,
  createTeam,
  getSettings,
  updateCampaign,
  updateCycle,
} from "@/lib/domain/settings/service";
import type { Campaign, ElectionCycle, Region, Team } from "@/lib/repositories/interfaces";

export type SettingsReader = {
  snapshot(actor: Actor): {
    campaign: Campaign | null;
    cycles: ElectionCycle[];
    regions: Region[];
    teams: Team[];
  };
};

export type SettingsWriter = {
  updateCampaign(actor: Actor, patch: unknown): Campaign;
  createCycle(actor: Actor, input: unknown): ElectionCycle;
  updateCycle(actor: Actor, id: string, patch: unknown): ElectionCycle;
  createRegion(actor: Actor, input: unknown): Region;
  createTeam(actor: Actor, input: unknown): Team;
};

function unwrap<T>(result: { ok: true; value: T } | { ok: false; status: number; errors: Record<string, string> }): T {
  if (result.ok) return result.value;
  const message = Object.values(result.errors).join(" · ") || "فشل غير محدَّد";
  throw new ToolFailure(`domain.${result.status}`, message);
}

const settingsCell = defineCell({
  manifest: {
    id: "settings",
    version: "1.0.0",
    title: { ar: "نواة الإعدادات", en: "Settings Nucleus" },
    corner: "إعدادات الحملة",
    summary: {
      ar: "تدير الحملة والدورات الانتخابية والمناطق والفرق — بصلاحية `settings:manage` وحدها.",
      en: "Manages the campaign, election cycles, regions, and teams under `settings:manage` alone.",
    },
    provides: ["settings.campaign", "settings.structure"],
    requires: ["auth.session", "audit.trail"],
    emits: ["settings.changed"],
    consumes: [],
    config: [
      {
        key: "default_cycle_status",
        label: { ar: "حالة الدورة الافتراضية", en: "Default cycle status" },
        default: "planned",
        effect: {
          ar: "الحالة عند إنشاء دورة بلا حالة صريحة: planned / active / closed.",
          en: "Status applied when a cycle is created without an explicit one: planned / active / closed.",
        },
      },
      {
        key: "max_cycle_year",
        label: { ar: "أقصى سنة للدورة", en: "Maximum cycle year" },
        default: 2100,
        effect: {
          ar: "سقف سنة تاريخ الانتخاب المقبول في هذا الركن (2020-2200).",
          en: "Upper bound on the accepted election year in this corner (2020-2200).",
        },
      },
      {
        key: "allow_structure_changes",
        label: { ar: "السماح بتعديل الهيكل", en: "Allow structure changes" },
        default: true,
        effect: {
          ar: "عند التعطيل يُقفل إنشاء المناطق والفرق (تبقى القراءة متاحة) — مَقبض تجميد بلا نشر جديد.",
          en: "When disabled, region/team creation is locked (reading stays available) — a freeze knob with no redeploy.",
        },
      },
    ],
    tools: [
      {
        name: "settings.get",
        label: { ar: "قراءة الإعدادات", en: "Read settings" },
        capability: "settings.campaign",
        risk: "read",
        input: {},
        requiresApprovalForAgents: false,
      },
      {
        name: "settings.update_campaign",
        label: { ar: "تعديل الحملة", en: "Update campaign" },
        capability: "settings.campaign",
        risk: "write",
        input: { name: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "settings.create_cycle",
        label: { ar: "إنشاء دورة", en: "Create cycle" },
        capability: "settings.structure",
        risk: "write",
        input: { name: "string", election_date: "string", status: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "settings.update_cycle",
        label: { ar: "تعديل دورة", en: "Update cycle" },
        capability: "settings.structure",
        risk: "write",
        input: { id: "string", name: "string", election_date: "string", status: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "settings.create_region",
        label: { ar: "إنشاء منطقة", en: "Create region" },
        capability: "settings.structure",
        risk: "write",
        input: { name: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "settings.create_team",
        label: { ar: "إنشاء فريق", en: "Create team" },
        capability: "settings.structure",
        risk: "write",
        input: { name: "string", region_id: "string" },
        requiresApprovalForAgents: true,
      },
    ],
  },

  services: {
    "settings.campaign": {
      snapshot(actor: Actor) {
        return unwrap(getSettings(toDomainActor(actor), repos()));
      },
    } satisfies SettingsReader,

    "settings.structure": {
      updateCampaign(actor: Actor, patch: unknown): Campaign {
        return unwrap(updateCampaign(toDomainActor(actor), patch, repos()));
      },
      createCycle(actor: Actor, input: unknown): ElectionCycle {
        return unwrap(createCycle(toDomainActor(actor), input, repos()));
      },
      updateCycle(actor: Actor, id: string, patch: unknown): ElectionCycle {
        return unwrap(updateCycle(toDomainActor(actor), id, patch, repos()));
      },
      createRegion(actor: Actor, input: unknown): Region {
        return unwrap(createRegion(toDomainActor(actor), input, repos()));
      },
      createTeam(actor: Actor, input: unknown): Team {
        return unwrap(createTeam(toDomainActor(actor), input, repos()));
      },
    } satisfies SettingsWriter,
  },

  tools: {
    "settings.get": (ctx) => ctx.require<SettingsReader>("settings.campaign").snapshot(ctx.actor),

    "settings.update_campaign": (ctx) => {
      const writer = ctx.require<SettingsWriter>("settings.structure");
      const campaign = writer.updateCampaign(ctx.actor, { name: ctx.input.name });
      ctx.emit("settings.changed", { entity: "campaign", id: campaign.id, name: campaign.name });
      return campaign;
    },

    "settings.create_cycle": (ctx) => {
      const writer = ctx.require<SettingsWriter>("settings.structure");
      const input = { ...(ctx.input as Record<string, unknown>) };
      if (input.status === undefined || input.status === "") {
        input.status = stringSlot(ctx.config.default_cycle_status, "planned", 20);
      }
      const year = Number(String(input.election_date ?? "").slice(0, 4));
      const maxYear = numberSlot(ctx.config.max_cycle_year, 2100, 2020, 2200);
      if (Number.isFinite(year) && year > maxYear) {
        throw new ToolFailure("settings.year", `سنة الدورة (${year}) تتجاوز سقف هذا الركن (${maxYear})`);
      }
      const cycle = writer.createCycle(ctx.actor, input);
      ctx.emit("settings.changed", { entity: "cycle", id: cycle.id, election_date: cycle.election_date });
      return cycle;
    },

    "settings.update_cycle": (ctx) => {
      const writer = ctx.require<SettingsWriter>("settings.structure");
      const { id, ...patch } = ctx.input as Record<string, unknown>;
      const cycle = writer.updateCycle(ctx.actor, String(id ?? ""), patch);
      ctx.emit("settings.changed", { entity: "cycle", id: cycle.id, status: cycle.status });
      return cycle;
    },

    "settings.create_region": (ctx) => {
      if (ctx.config.allow_structure_changes !== true) {
        throw new ToolFailure("settings.frozen", "تعديل الهيكل مُقفل في هذا الركن");
      }
      const writer = ctx.require<SettingsWriter>("settings.structure");
      const region = writer.createRegion(ctx.actor, { name: ctx.input.name });
      ctx.emit("settings.changed", { entity: "region", id: region.id, name: region.name });
      return region;
    },

    "settings.create_team": (ctx) => {
      if (ctx.config.allow_structure_changes !== true) {
        throw new ToolFailure("settings.frozen", "تعديل الهيكل مُقفل في هذا الركن");
      }
      const writer = ctx.require<SettingsWriter>("settings.structure");
      const team = writer.createTeam(ctx.actor, {
        name: ctx.input.name,
        region_id: ctx.input.region_id ?? null,
      });
      ctx.emit("settings.changed", { entity: "team", id: team.id, name: team.name });
      return team;
    },
  },

  health() {
    try {
      const store = repos();
      const campaign = store.campaign.get();
      return {
        ok: campaign !== null,
        detail: campaign
          ? `الحملة: ${campaign.name} — ${store.regions.list().length} منطقة، ${store.teams.list().length} فريق`
          : "لا حملة مُهيَّأة في المخزن",
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

export { settingsCell };
