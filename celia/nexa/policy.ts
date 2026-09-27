/**
 * NEXA — محرّك السياسة (Policy). «Policy decides» — لا الوكيل.
 *
 * قواعد افتراضية قابلة للتركيب: تصنيف البيانات مقابل تصريح المزوّد، التكلفة مقابل السقف والميزانية،
 * الخطورة (قراءة تمرّ؛ كتابة/إدارة/تدمير تتطلب موافقة بشرية؛ التدمير يتطلب محاكاة أولًا)،
 * مطابقة الخطورة المعلنة لخطورة القدرة، ومستوى الثقة.
 *
 * الحكم: DENY يغلب REQUIRE_APPROVAL يغلب ADMIT. ADMIT ليس تصريح تنفيذ — هو «مقبول للمرور إلى التفويض».
 */
import type { Capability } from "./capability.ts";
import { dataRank, riskRank, type DataClass, type Proposal } from "./protocol.ts";

export type PrivacyMode = "LOCAL" | "HYBRID" | "CLOUD";

export type PolicyContext = {
  capability: Capability;
  proposal: Proposal;
  /** المتبقي من ميزانية المهمة بالدولار (Cost Guard). */
  budgetRemainingUsd: number;
  /** وضع الخصوصية (§18). في LOCAL لا يُسمح لأي مزوّد غير محلي إلا بـPUBLIC. */
  mode: PrivacyMode;
  /** هل لدى الاقتراح تقرير محاكاة (مطلوب للتدميري — §16). */
  simulated: boolean;
  /** مزوّدون يُعدّون محليين (لا تغادر البيانات الجهاز). */
  localProviders?: readonly string[];
};

export type Severity = "deny" | "require_approval" | "info";
/** رموز ثابتة قابلة للقراءة آليًا: NEXA_E_* = رفض، NEXA_A_* = يتطلب موافقة، NEXA_I_* = معلومة. */
export type PolicyCode =
  | "NEXA_E_DATA_CLASS"
  | "NEXA_E_PRIVACY_MODE"
  | "NEXA_E_COST_CAP_INVALID"
  | "NEXA_E_COST_UNKNOWN"
  | "NEXA_E_COST_EXCEEDS_CAP"
  | "NEXA_E_COST_EXCEEDS_BUDGET"
  | "NEXA_E_RISK_UNDERSTATED"
  | "NEXA_E_NOT_READ_ONLY"
  | "NEXA_E_SIMULATION_REQUIRED"
  | "NEXA_E_AVAILABILITY_UNKNOWN"
  | "NEXA_E_QUOTA"
  | "NEXA_A_PAID"
  | "NEXA_A_RISK"
  | "NEXA_A_TRUST_UNKNOWN"
  | "NEXA_I_QUOTA";
export type PolicyFinding = { rule: string; severity: Severity; code: PolicyCode; reason: string };

/** قرار GEN-1 §2: السقف الافتراضي للإنفاق = 0. غير محدد/مجهول/سالب لا يتحوّل أبدًا إلى قيمة مسموحة. */
export const DEFAULT_SPEND_CAP_USD = 0;
export type PolicyRule = { id: string; evaluate(ctx: PolicyContext): PolicyFinding[] };
export type PolicyDecision = { decision: "ADMIT" | "REQUIRE_APPROVAL" | "DENY"; findings: PolicyFinding[] };

export const finding = (rule: string, severity: Severity, code: PolicyCode, reason: string): PolicyFinding => ({ rule, severity, code, reason });

/** تصنيف البيانات: لا يُرسل ما يفوق تصريح القدرة؛ SECRET/CRITICAL لا يغادران إلا لمزوّد مصرَّح له صراحةً. */
export const dataClassRule: PolicyRule = {
  id: "data-class",
  evaluate(ctx) {
    const { proposal, capability } = ctx;
    const out: PolicyFinding[] = [];
    if (dataRank(proposal.dataClass) > dataRank(capability.dataClearance)) {
      out.push(finding(this.id, "deny", "NEXA_E_DATA_CLASS", `data class ${proposal.dataClass} exceeds provider clearance ${capability.dataClearance} (${capability.provider})`));
    }
    const isLocal = (ctx.localProviders ?? ["local"]).includes(capability.provider);
    if (ctx.mode === "LOCAL" && !isLocal && proposal.dataClass !== "PUBLIC") {
      out.push(finding(this.id, "deny", "NEXA_E_PRIVACY_MODE", `LOCAL mode: only PUBLIC data may reach non-local provider ${capability.provider}`));
    }
    if (ctx.mode === "HYBRID" && !isLocal && dataRank(proposal.dataClass) >= dataRank("PRIVATE" satisfies DataClass)) {
      out.push(finding(this.id, "deny", "NEXA_E_PRIVACY_MODE", `HYBRID mode: ${proposal.dataClass} data stays local; provider ${capability.provider} is not local`));
    }
    return out;
  },
};

/**
 * التكلفة (قرار GEN-1 §2): سقف غير صالح/غائب ⇒ رفض · مجهولة/ديناميكية ⇒ رفض (لا حدّ أعلى موثّق = لا تنفيذ) ·
 * ثابتة ⇒ ≤ سقف الاقتراح و≤ الميزانية المتبقية · وكل فعل **مدفوع** — حتى القرائي — يتطلب موافقة بشرية (paid execution = OFF BY DEFAULT).
 */
export const costRule: PolicyRule = {
  id: "cost",
  evaluate(ctx) {
    const { capability, proposal } = ctx;
    if (typeof proposal.maxCostUsd !== "number" || !Number.isFinite(proposal.maxCostUsd) || proposal.maxCostUsd < 0) {
      return [finding(this.id, "deny", "NEXA_E_COST_CAP_INVALID", `proposal cost cap is not a valid non-negative number (${String(proposal.maxCostUsd)}); default is ${DEFAULT_SPEND_CAP_USD}`)];
    }
    if (capability.costModel === "free" && proposal.maxCostUsd === 0) return [];
    if (capability.costModel === "free") return [finding(this.id, "require_approval", "NEXA_A_PAID", `proposal carries a cost cap ${proposal.maxCostUsd} USD on a free capability: human approval required`)];
    if (capability.costModel !== "fixed" || capability.fixedCostUsd === null || !Number.isFinite(capability.fixedCostUsd)) {
      return [finding(this.id, "deny", "NEXA_E_COST_UNKNOWN", `cost model ${capability.costModel}: no documented upper bound`)];
    }
    const out: PolicyFinding[] = [];
    if (capability.fixedCostUsd > proposal.maxCostUsd) out.push(finding(this.id, "deny", "NEXA_E_COST_EXCEEDS_CAP", `fixed cost ${capability.fixedCostUsd} USD exceeds proposal cap ${proposal.maxCostUsd} USD`));
    if (capability.fixedCostUsd > ctx.budgetRemainingUsd) out.push(finding(this.id, "deny", "NEXA_E_COST_EXCEEDS_BUDGET", `fixed cost ${capability.fixedCostUsd} USD exceeds remaining budget ${ctx.budgetRemainingUsd} USD`));
    out.push(finding(this.id, "require_approval", "NEXA_A_PAID", `paid action (fixed ${capability.fixedCostUsd} USD) requires human approval`));
    return out;
  },
};

/** التوفّر (قرار GEN-1 §1): availability=unknown ⇒ DENY — نقص في شرط أساسي، لا «عملية خطرة يوافق عليها المستخدم». */
export const availabilityRule: PolicyRule = {
  id: "availability",
  evaluate(ctx) {
    if (ctx.capability.availability !== "known") return [finding(this.id, "deny", "NEXA_E_AVAILABILITY_UNKNOWN", `capability "${ctx.capability.id}" availability is ${String(ctx.capability.availability)}: precondition unknown`)];
    return [];
  },
};

/** الخطورة: القراءة تمرّ؛ ما فوقها يتطلب موافقة بشرية؛ التدميري بلا محاكاة ⇒ رفض. */
export const riskRule: PolicyRule = {
  id: "risk",
  evaluate(ctx) {
    const { proposal, capability } = ctx;
    const out: PolicyFinding[] = [];
    if (riskRank(proposal.risk) < riskRank(capability.risk)) {
      out.push(finding(this.id, "deny", "NEXA_E_RISK_UNDERSTATED", `proposal declares risk ${proposal.risk} but capability is ${capability.risk} (risk understated)`));
    }
    if (proposal.risk === "read" && !capability.readOnly) {
      out.push(finding(this.id, "deny", "NEXA_E_NOT_READ_ONLY", `proposal declares read but capability "${capability.id}" is not read-only`));
    }
    if (proposal.risk === "destructive" && !ctx.simulated) {
      out.push(finding(this.id, "deny", "NEXA_E_SIMULATION_REQUIRED", "destructive scope requires a simulation report before approval"));
    }
    if (proposal.risk !== "read") out.push(finding(this.id, "require_approval", "NEXA_A_RISK", `${proposal.risk} action requires human approval`));
    return out;
  },
};

/** الثقة: قدرة غير موثّقة تتطلب موافقة حتى للقراءة. */
export const trustRule: PolicyRule = {
  id: "trust",
  evaluate(ctx) {
    if (ctx.capability.trust === "unknown") return [finding(this.id, "require_approval", "NEXA_A_TRUST_UNKNOWN", `capability "${ctx.capability.id}" has unknown trust`)];
    return [];
  },
};

export const DEFAULT_RULES: readonly PolicyRule[] = [dataClassRule, costRule, availabilityRule, riskRule, trustRule];

/** رموز الرفض/الموافقة في قرار — للتقارير والاختبارات. */
export const policyCodes = (d: PolicyDecision): PolicyCode[] => [...new Set(d.findings.filter((f) => f.severity !== "info").map((f) => f.code))];

export function evaluatePolicy(ctx: PolicyContext, rules: readonly PolicyRule[] = DEFAULT_RULES): PolicyDecision {
  const findings = rules.flatMap((r) => r.evaluate(ctx));
  const decision = findings.some((f) => f.severity === "deny") ? "DENY" : findings.some((f) => f.severity === "require_approval") ? "REQUIRE_APPROVAL" : "ADMIT";
  return { decision, findings };
}
