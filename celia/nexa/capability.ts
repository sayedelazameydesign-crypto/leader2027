/**
 * NEXA — سجل القدرات (Capability Registry).
 *
 * كل قدرة (أداة/مهارة/نموذج/وكيل/موصّل/سير عمل) تُعلن: المزوّد، الخطورة، نموذج التكلفة،
 * أعلى تصنيف بيانات مسموح إرساله إليها، هل هي قراءة‑فقط، الإصدار، ومستوى الثقة.
 * حالة السلّم لكل قدرة تُرفع **بمرجع دليل** ولا تُعلَن.
 */
import { CAPABILITY_LADDER, NexaError, ladderRank, type CapabilityState, type DataClass, type RiskLevel } from "./protocol.ts";

export type CapabilityKind = "tool" | "skill" | "model" | "agent" | "connector" | "workflow";
export type CostModel = "free" | "fixed" | "dynamic" | "unknown";
export type TrustLevel = "verified" | "declared" | "unknown";
/**
 * معرفة التوفّر (قرار GEN-1 §1): KNOWN = التوفّر موثّق (كتالوج/دليل)؛ UNKNOWN = شرط أساسي للتنفيذ ناقص ⇒ DENY، لا موافقة.
 * منفصلة عن الثقة (trust = مصدر الوصف) وعن سلّم القدرة (state = ما ثبت بالدليل).
 */
export type AvailabilityKnowledge = "known" | "unknown";

export type Capability = {
  id: string;
  kind: CapabilityKind;
  provider: string;
  risk: RiskLevel;
  costModel: CostModel;
  /** للتكلفة الثابتة فقط — الحدّ الأعلى الموثّق بالدولار للنداء الواحد. */
  fixedCostUsd: number | null;
  /** أعلى تصنيف بيانات يجوز إرساله إلى هذه القدرة/مزوّدها. */
  dataClearance: DataClass;
  readOnly: boolean;
  version: string;
  trust: TrustLevel;
  availability: AvailabilityKnowledge;
};

export type CapabilityStatus = {
  capability: Capability;
  state: CapabilityState;
  evidence: Array<{ state: CapabilityState; ref: string; at: string }>;
};

export class CapabilityRegistry {
  private readonly items = new Map<string, CapabilityStatus>();

  register(capability: Capability): CapabilityStatus {
    if (this.items.has(capability.id)) throw new NexaError("DUPLICATE_CAPABILITY", `capability "${capability.id}" already registered`);
    const status: CapabilityStatus = { capability, state: "CAN", evidence: [] };
    this.items.set(capability.id, status);
    return status;
  }

  get(id: string): CapabilityStatus {
    const s = this.items.get(id);
    if (!s) throw new NexaError("UNKNOWN_CAPABILITY", `capability "${id}" is not registered`);
    return s;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  list(): CapabilityStatus[] {
    return [...this.items.values()];
  }

  /** رفع الحالة درجةً واحدة بدليل؛ الهبوط مسموح فقط عبر `reset` الصريح (مثلًا: فشل المصادقة). */
  raise(id: string, to: CapabilityState, evidenceRef: string, at: string): CapabilityStatus {
    const s = this.get(id);
    if (!evidenceRef) throw new NexaError("EVIDENCE_REQUIRED", `raising "${id}" to ${to} requires evidence`);
    if (ladderRank(to) !== ladderRank(s.state) + 1) {
      throw new NexaError("LADDER_ORDER", `"${id}": ${s.state} → ${CAPABILITY_LADDER[ladderRank(s.state) + 1] ?? "(top)"} expected, got ${to}`);
    }
    s.state = to;
    s.evidence.push({ state: to, ref: evidenceRef, at });
    return s;
  }

  reset(id: string, to: CapabilityState, reason: string, at: string): CapabilityStatus {
    const s = this.get(id);
    if (ladderRank(to) > ladderRank(s.state)) throw new NexaError("RESET_UPWARD", "reset can only lower or keep the state");
    s.state = to;
    s.evidence.push({ state: to, ref: `reset: ${reason}`, at });
    return s;
  }
}
