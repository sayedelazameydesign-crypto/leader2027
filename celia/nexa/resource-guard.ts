/**
 * NEXA — حارس الموارد (Resource Guard) — FREE-FIRST · FAIL-CLOSED · NO SURPRISE BILL.
 *
 * حصص صريحة لكل مورد (طلبات، صفوف، نيورونات، دقائق CI، إنفاق بالدولار …) ومستويات:
 *   < 80%  NORMAL     كل شيء
 *   ≥ 80%  WARN       كل شيء + تحذير في الدليل
 *   ≥ 90%  RESTRICT   لا مدفوع، لا admin/destructive
 *   ≥ 95%  SAFE_MODE  قراءة مجانية فقط (Read · Inspect · Plan · Analyze · Verify)
 *   ≥ 100% DENY       لا شيء على هذا المورد
 * لا يوجد «ترقية تلقائية» ولا «اشحن بطاقتي»: انتهاء الحصة يهبط بالنظام إلى وضع آمن، لا إلى فاتورة.
 */
import { NexaError, type RiskLevel } from "./protocol.ts";

export type ResourceLevel = "NORMAL" | "WARN" | "RESTRICT" | "SAFE_MODE" | "DENY";
export type Quota = { limit: number; used: number; unit: string };
export type ResourceStatus = { resource: string; limit: number; used: number; unit: string; ratio: number; level: ResourceLevel };

export const RESOURCE_THRESHOLDS: ReadonlyArray<[number, ResourceLevel]> = [
  [1.0, "DENY"],
  [0.95, "SAFE_MODE"],
  [0.9, "RESTRICT"],
  [0.8, "WARN"],
];

export function levelOf(ratio: number): ResourceLevel {
  for (const [t, level] of RESOURCE_THRESHOLDS) if (ratio >= t) return level;
  return "NORMAL";
}

export class ResourceGuard {
  private readonly quotas = new Map<string, Quota>();

  constructor(quotas: Record<string, { limit: number; used?: number; unit: string }>) {
    for (const [name, q] of Object.entries(quotas)) {
      if (!(q.limit >= 0) || !Number.isFinite(q.limit)) throw new NexaError("BAD_QUOTA", `quota ${name}: limit must be a finite number >= 0`);
      this.quotas.set(name, { limit: q.limit, used: q.used ?? 0, unit: q.unit });
    }
  }

  status(resource: string): ResourceStatus {
    const q = this.quotas.get(resource);
    if (!q) throw new NexaError("UNKNOWN_RESOURCE", `resource "${resource}" has no quota (fail-closed: declare it first)`);
    const ratio = q.limit === 0 ? (q.used > 0 ? 1 : 0) : q.used / q.limit;
    return { resource, limit: q.limit, used: q.used, unit: q.unit, ratio, level: levelOf(ratio) };
  }

  all(): ResourceStatus[] {
    return [...this.quotas.keys()].map((r) => this.status(r));
  }

  /** أعلى مستوى بين كل الموارد — وضع النظام. */
  mode(): ResourceLevel {
    const order: ResourceLevel[] = ["NORMAL", "WARN", "RESTRICT", "SAFE_MODE", "DENY"];
    return this.all().reduce<ResourceLevel>((acc, s) => (order.indexOf(s.level) > order.indexOf(acc) ? s.level : acc), "NORMAL");
  }

  /** هل يُسمح باستهلاك `units` من المورد لفعل بهذه الخطورة/التكلفة؟ يُقيَّم على الحالة **بعد** الاستهلاك. */
  admit(resource: string, units: number, action: { risk: RiskLevel; paid: boolean }): { ok: boolean; level: ResourceLevel; reason: string } {
    const s = this.status(resource);
    const after = s.limit === 0 ? (s.used + units > 0 ? 1 : 0) : (s.used + units) / s.limit;
    const level = levelOf(after);
    const tag = `${resource} ${s.used}+${units}/${s.limit} ${s.unit} (${Math.round(after * 100)}% ${level})`;
    if (level === "DENY") return { ok: false, level, reason: `quota exhausted: ${tag}` };
    if (level === "SAFE_MODE" && (action.paid || action.risk !== "read")) return { ok: false, level, reason: `safe mode: only free read actions: ${tag}` };
    if (level === "RESTRICT" && (action.paid || action.risk === "admin" || action.risk === "destructive")) return { ok: false, level, reason: `restricted: no paid/admin/destructive actions: ${tag}` };
    return { ok: true, level, reason: tag };
  }

  record(resource: string, units: number): ResourceStatus {
    const q = this.quotas.get(resource);
    if (!q) throw new NexaError("UNKNOWN_RESOURCE", `resource "${resource}" has no quota`);
    if (!(units >= 0)) throw new NexaError("BAD_UNITS", "units must be >= 0");
    q.used += units;
    return this.status(resource);
  }

  summary(): string {
    return this.all().map((s) => `${s.resource}=${s.used}/${s.limit}${s.unit === "count" ? "" : s.unit} (${Math.round(s.ratio * 100)}% ${s.level})`).join(" ");
  }
}
