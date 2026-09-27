/**
 * NEXA — بروتوكول الفعل (Action Protocol) وسلّم القدرة (Capability Ladder).
 *
 * كل فعل في Celia يمرّ بالمراحل نفسها، بالترتيب، بلا قفز:
 *   INTENT → PROPOSAL → CAPABILITY → POLICY → AUTHORIZATION → APPROVAL → EXECUTION
 *   → OBSERVATION → VERIFICATION → EVIDENCE → MEMORY
 *
 * والقاعدة الأهم (§24): النظام لا يقول «أستطيع» — بل يميّز:
 *   CAN ≠ AVAILABLE ≠ AUTHORIZED ≠ EXECUTABLE ≠ EXECUTED ≠ VERIFIED
 *
 * هذه الوحدة نقية (لا شبكة، لا ملفات): أنواع، ثوابت، آلة حالات، وتجزئة الاقتراح.
 * بنية TypeScript قابلة للمحو فقط (تعمل مباشرة بـNode ≥ 22.18).
 */
import { createHash } from "node:crypto";

export const ACTION_STAGES = [
  "INTENT",
  "PROPOSAL",
  "CAPABILITY",
  "POLICY",
  "AUTHORIZATION",
  "APPROVAL",
  "EXECUTION",
  "OBSERVATION",
  "VERIFICATION",
  "EVIDENCE",
  "MEMORY",
] as const;
export type ActionStage = (typeof ACTION_STAGES)[number];

export const CAPABILITY_LADDER = ["CAN", "AVAILABLE", "AUTHORIZED", "EXECUTABLE", "EXECUTED", "VERIFIED"] as const;
export type CapabilityState = (typeof CAPABILITY_LADDER)[number];

/** تصنيف البيانات (§18) — الموجّه يرفض إرسال SECRET/CRITICAL إلى مزوّد غير مصرَّح له. */
export const DATA_CLASSES = ["PUBLIC", "INTERNAL", "PRIVATE", "SECRET", "CRITICAL"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** الخطورة — تمديد لسلّم النواة الحالية (read/write/admin) بمستوى تدميري صريح (§16). */
export const RISK_LEVELS = ["read", "write", "admin", "destructive"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const OUTCOME_STATUSES = ["COMPLETED", "PARTIAL", "BLOCKED", "NOT_VERIFIED", "FAILED"] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export class NexaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NexaError";
    this.code = code;
  }
}

export function rank<T extends string>(order: readonly T[], value: T): number {
  const i = order.indexOf(value);
  if (i < 0) throw new NexaError("UNKNOWN_VALUE", `unknown value "${String(value)}"`);
  return i;
}

export const stageRank = (s: ActionStage): number => rank(ACTION_STAGES, s);
export const ladderRank = (s: CapabilityState): number => rank(CAPABILITY_LADDER, s);
export const dataRank = (d: DataClass): number => rank(DATA_CLASSES, d);
export const riskRank = (r: RiskLevel): number => rank(RISK_LEVELS, r);

export function ladderAtLeast(state: CapabilityState, min: CapabilityState): boolean {
  return ladderRank(state) >= ladderRank(min);
}

/** JSON قانوني (مفاتيح مرتّبة) — أساس تجزئة الاقتراح وربط التصريح به. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type Intent = {
  id: string;
  actor: string;
  goal: string;
  project: string | null;
  at: string;
};

/** الاقتراح — ما يقترحه الوكيل. لا يحمل سلطة بذاته. */
export type Proposal = {
  id: string;
  intentId: string;
  /** معرّف القدرة في السجل (مثال: "aisa", "github", "fs"). */
  capability: string;
  /** العملية داخل القدرة (مثال: "post_tavily_extract", "git.push"). */
  operation: string;
  arguments: Record<string, unknown>;
  risk: RiskLevel;
  dataClass: DataClass;
  maxCostUsd: number;
  proposedBy: string;
  at: string;
};

/** تجزئة الاقتراح: ما يُربط به التصريح — القدرة والعملية والمعاملات والسقف فقط (لا الطوابع الزمنية). */
export function proposalHash(p: Pick<Proposal, "capability" | "operation" | "arguments" | "maxCostUsd">): string {
  return sha256Hex(canonicalJson({ capability: p.capability, operation: p.operation, arguments: p.arguments, maxCostUsd: p.maxCostUsd }));
}

export type StageEntry = { stage: ActionStage; at: string; note: string | null };

/** سجل الفعل — يتقدّم مرحلةً مرحلةً؛ حالة السلّم تُرفع بأدلة لا بادّعاء. */
export type ActionRecord = {
  proposal: Proposal;
  stage: ActionStage;
  ladder: CapabilityState;
  history: StageEntry[];
};

export function openAction(proposal: Proposal, at: string = proposal.at): ActionRecord {
  return {
    proposal,
    stage: "PROPOSAL",
    ladder: "CAN",
    history: [
      { stage: "INTENT", at, note: `intent=${proposal.intentId}` },
      { stage: "PROPOSAL", at, note: `hash=${proposalHash(proposal).slice(0, 12)}` },
    ],
  };
}

/** التقدّم إلى المرحلة التالية مباشرةً فقط — لا قفز فوق POLICY أو AUTHORIZATION أو APPROVAL. */
export function advance(record: ActionRecord, to: ActionStage, at: string, note: string | null = null): ActionRecord {
  const expected = ACTION_STAGES[stageRank(record.stage) + 1];
  if (!expected) throw new NexaError("PROTOCOL_COMPLETE", `action already at final stage ${record.stage}`);
  if (to !== expected) throw new NexaError("STAGE_ORDER", `cannot go ${record.stage} → ${to}; next stage is ${expected}`);
  return { ...record, stage: to, history: [...record.history, { stage: to, at, note }] };
}

/** رفع حالة السلّم — صعودًا فقط، درجةً واحدة، ومع مرجع دليل إلزامي. */
export function raiseLadder(record: ActionRecord, to: CapabilityState, evidenceRef: string, at: string): ActionRecord {
  if (!evidenceRef) throw new NexaError("EVIDENCE_REQUIRED", `raising to ${to} requires an evidence reference`);
  const from = ladderRank(record.ladder);
  const target = ladderRank(to);
  if (target !== from + 1) {
    throw new NexaError("LADDER_ORDER", `ladder moves one rung at a time: ${record.ladder} → ${CAPABILITY_LADDER[from + 1] ?? "(top)"}, not ${to}`);
  }
  return { ...record, ladder: to, history: [...record.history, { stage: record.stage, at, note: `ladder=${to} evidence=${evidenceRef}` }] };
}

/** الحدّ الأدنى من مرحلة البروتوكول الذي تتطلبه كل درجة في السلّم — يمنع «EXECUTED» قبل EXECUTION مثلًا. */
export const LADDER_REQUIRES_STAGE: Record<CapabilityState, ActionStage> = {
  CAN: "PROPOSAL",
  AVAILABLE: "CAPABILITY",
  AUTHORIZED: "APPROVAL",
  EXECUTABLE: "APPROVAL",
  EXECUTED: "OBSERVATION",
  VERIFIED: "VERIFICATION",
};

export function assertLadderConsistent(record: ActionRecord): void {
  const need = LADDER_REQUIRES_STAGE[record.ladder];
  if (stageRank(record.stage) < stageRank(need)) {
    throw new NexaError("LADDER_STAGE", `ladder ${record.ladder} requires stage ≥ ${need}, but action is at ${record.stage}`);
  }
}
