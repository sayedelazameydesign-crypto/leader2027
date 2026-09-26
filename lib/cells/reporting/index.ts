/**
 * نواة المؤشرات — `reporting` (النواة **الحيّة**)
 *
 * الركن: لوحة القيادة والمؤشرات التشغيلية.
 *
 * هذه النواة تُظهر «الحياة» فعليًا:
 *   - تُجمِّع من ثلاث قدرات (أشخاص/متطوعون/تقارير) بلا استيراد أي نواة.
 *   - تُخزِّن المؤشرات مؤقتًا (cache) لمدة قابلة للتعديل من مَقبض واحد.
 *   - **تُبطل الذاكرة تلقائيًا** عند وصول أي حدث يمسّ أرقامها (لا polling).
 *   - تعيد الحساب عند انتهاء المدة أو عند الإبطال.
 *
 * نمط «الخدمة المرتبطة بالتركيب»: الخدمة تُبنى قبل التركيب، وتلتقط سياق التركيب
 * في `onMount`. بهذا تبقى واجهة القدرة نظيفة (لا تمرير سياق في كل نداء).
 */
import { defineCell, type Actor, type MountContext } from "@/lib/kernel/types";
import { numberSlot, toDomainActor, ToolFailure } from "@/lib/kernel/bridge";
import { can } from "@/lib/authorization/policy";

export type Kpis = {
  people: number;
  volunteers: number;
  reports: number;
  peopleContacted: number;
  volunteersPresent: number;
};

export type ReportingService = {
  /** المؤشرات الحالية — من الذاكرة إن كانت صالحة، وإلا بإعادة حساب حقيقية. */
  current(actor: Actor): Kpis & { cached: boolean; computedAt: string; ageMs: number };
  /** إبطال فوري للذاكرة (يُنادى من الأحداث ومن المَقابض). */
  invalidate(reason: string): void;
  /** إحصاء داخلي — أثر الحياة (كم مرة أُبطلت وكم مرة أُعيد الحساب). */
  stats(): { invalidations: number; recomputes: number };
};

/** الأشكال التي نحتاجها من القدرات — مُعلَنة هنا، بلا استيراد أي نواة. */
type PeopleLookup = { list(actor: Actor): Array<{ id: string }> };
type VolunteersLookup = { list(actor: Actor): Array<{ status: string }> };
type ReportsLookup = {
  list(actor: Actor): Array<{ people_contacted: number; volunteers_present: number }>;
};

type CacheEntry = { kpis: Kpis; computedAtMs: number; computedAt: string };

/** السياق المُلتقَط عند التركيب — الخدمة تعمل به بعد ذلك. */
let bound: MountContext | null = null;

const state = {
  cache: null as CacheEntry | null,
  invalidations: 0,
  recomputes: 0,
};

function context(): MountContext {
  if (!bound) {
    throw new ToolFailure("reporting.unmounted", "نواة المؤشرات غير مُركَّبة بعد");
  }
  return bound;
}

/** حساب حقيقي من القدرات الثلاث — لا وصول مباشر لأي مخزن. */
function compute(actor: Actor): Kpis {
  const ctx = context();
  const countInactive = ctx.config.count_inactive_volunteers === true;

  const people = ctx.require<PeopleLookup>("people.read").list(actor);
  const volunteers = ctx.require<VolunteersLookup>("volunteers.read").list(actor);
  const reports = ctx.require<ReportsLookup>("field.reports.read").list(actor);

  return {
    people: people.length,
    volunteers: countInactive ? volunteers.length : volunteers.filter((v) => v.status === "active").length,
    reports: reports.length,
    peopleContacted: reports.reduce((sum, r) => sum + r.people_contacted, 0),
    volunteersPresent: reports.reduce((sum, r) => sum + r.volunteers_present, 0),
  };
}

const reportingService: ReportingService = {
  current(actor: Actor) {
    const domainActor = toDomainActor(actor);
    if (!can(domainActor, "dashboard:view")) {
      throw new ToolFailure("forbidden", "لا تملك صلاحية `dashboard:view`");
    }

    const ctx = context();
    const ttlMs = numberSlot(ctx.config.cache_ttl_ms, 5000, 0, 600_000);
    const cacheEnabled = ctx.config.cache_enabled !== false;
    const now = Date.now();

    if (cacheEnabled && state.cache && now - state.cache.computedAtMs <= ttlMs) {
      return {
        ...state.cache.kpis,
        cached: true,
        computedAt: state.cache.computedAt,
        ageMs: now - state.cache.computedAtMs,
      };
    }

    const kpis = compute(actor);
    const computedAt = new Date(now).toISOString();
    state.cache = { kpis, computedAtMs: now, computedAt };
    state.recomputes += 1;

    ctx.emit("reporting.snapshot.recomputed", { ...kpis, computedAt });
    return { ...kpis, cached: false, computedAt, ageMs: 0 };
  },

  invalidate(reason: string) {
    const had = state.cache !== null;
    state.cache = null;
    if (had) state.invalidations += 1;
    try {
      context().emit("reporting.cache.invalidated", { reason, invalidations: state.invalidations });
    } catch {
      /* الإبطال لا يفشل إن كانت النواة غير مُركَّبة */
    }
  },

  stats() {
    return { invalidations: state.invalidations, recomputes: state.recomputes };
  },
};

const reportingCell = defineCell({
  manifest: {
    id: "reporting",
    version: "1.0.0",
    title: { ar: "نواة المؤشرات", en: "Reporting Nucleus" },
    corner: "لوحة القيادة والمؤشرات",
    summary: {
      ar: "تحسب مؤشرات التشغيل من قدرات بقية الأنوية، وتُبطل ذاكرتها تلقائيًا عند كل تغيير.",
      en: "Computes operational KPIs from other nuclei's capabilities and self-invalidates its cache on every change.",
    },
    provides: ["reporting.kpis"],
    requires: ["people.read", "volunteers.read", "field.reports.read", "auth.session"],
    emits: ["reporting.snapshot.recomputed", "reporting.cache.invalidated"],
    consumes: [
      "people.created",
      "people.updated",
      "volunteers.created",
      "volunteers.status_changed",
      "field.report.submitted",
      "field.report.updated",
      "kernel.config.changed",
      "kernel.config.reset",
    ],
    config: [
      {
        key: "cache_ttl_ms",
        label: { ar: "صلاحية الذاكرة المؤقتة", en: "Cache TTL" },
        default: 5000,
        effect: {
          ar: "مدة إعادة استخدام المؤشرات قبل إعادة الحساب (0-600000 مللي ثانية). الإبطال بالحدث يسبقها دائمًا.",
          en: "How long KPIs are reused before recomputation (0-600000 ms). Event invalidation always takes precedence.",
        },
      },
      {
        key: "count_inactive_volunteers",
        label: { ar: "احتساب غير النشطين", en: "Count inactive volunteers" },
        default: false,
        effect: {
          ar: "عند التمكين يُحتسب كل المتطوعين لا النشطين وحدهم — تغيير رقمي مباشر من مَقبض واحد.",
          en: "When enabled, all volunteers are counted rather than active ones only — a direct numeric change from one knob.",
        },
      },
      {
        key: "cache_enabled",
        label: { ar: "تمكين الذاكرة المؤقتة", en: "Cache enabled" },
        default: true,
        effect: {
          ar: "عند التعطيل يُعاد الحساب في كل نداء — مفيد للتشخيص ومقارنة الأرقام لحظيًا.",
          en: "When disabled, KPIs recompute on every call — useful for diagnostics and live comparison.",
        },
      },
    ],
    tools: [
      {
        name: "reporting.kpis",
        label: { ar: "المؤشرات التشغيلية", en: "Operational KPIs" },
        capability: "reporting.kpis",
        risk: "read",
        input: { fresh: "boolean" },
        requiresApprovalForAgents: false,
      },
    ],
  },

  services: {
    "reporting.kpis": reportingService,
  },

  onMount(ctx) {
    // التقاط السياق + التحقق المبكر من القدرات الثلاث (وإلا يُعزل الركن)
    bound = ctx;
    ctx.require<PeopleLookup>("people.read");
    ctx.require<VolunteersLookup>("volunteers.read");
    ctx.require<ReportsLookup>("field.reports.read");
  },

  onUnmount() {
    bound = null;
    state.cache = null;
  },

  /**
   * الحياة: أي حدث يمسّ الأرقام يُبطل الذاكرة فورًا.
   * وتغيير مَقابض هذا الركن يُبطلها أيضًا — وإلا بقي الرقم القديم معروضًا
   * بعد تعديل الإعداد (إبطال مبني على الحدث، لا إعادة تشغيل).
   */
  onEvent(event, ctx) {
    void ctx;
    const payload = (event.payload ?? {}) as { cell?: string };
    if (event.type.startsWith("kernel.config.") && payload.cell !== "reporting") return;
    reportingService.invalidate(event.type);
  },

  tools: {
    "reporting.kpis": (ctx) => {
      // مَقبض تشخيصي: `fresh: true` يتجاوز الذاكرة لحظة واحدة بلا تغيير الإعدادات
      if (ctx.input.fresh === true) reportingService.invalidate("fresh_requested");
      const kpis = reportingService.current(ctx.actor);
      return { ...kpis, stats: reportingService.stats() };
    },
  },

  health: () => ({
    ok: true,
    detail: `المؤشرات ${state.cache ? "مُخزَّنة مؤقتًا" : "غير مُخزَّنة"} — ${state.recomputes} إعادة حساب، ${state.invalidations} إبطال`,
    at: new Date().toISOString(),
  }),
});

export { reportingCell };
