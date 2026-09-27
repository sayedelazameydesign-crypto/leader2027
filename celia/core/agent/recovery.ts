/**
 * Celia · core/agent · **التعافي** (GEN-2): بعد فشل خطوة — إعادة المحاولة (عابر فقط، وضمن الحدّ)، أو إعادة التخطيط، أو الاستسلام.
 * قاعدة صلبة: ما رفضته NEXA لا يُعاد تقديمه كما هو أبدًا؛ التغيير يأتي من إعادة التخطيط (مرشح آخر).
 */
import type { StepAttempt, StepRecord } from "../task/index.ts";
import type { AgentLimits, FailureClass } from "./context.ts";

export type RecoveryDecision = { action: "retry" | "replan" | "fail"; reason: string };

export function decideRecovery(record: StepRecord, attempt: StepAttempt, limits: AgentLimits, failureClass: FailureClass): RecoveryDecision {
  if (attempt.outcome === "DENIED") return { action: "replan", reason: `NEXA denied at ${attempt.deniedAt} (${attempt.codes.join(",") || attempt.reason}); the same proposal is never retried` };
  const maxRetries = record.step.maxRetries ?? limits.maxRetriesPerStep;
  if (failureClass === "transient" && record.retries < maxRetries) return { action: "retry", reason: `transient failure (${attempt.reason}); retry ${record.retries + 1}/${maxRetries}` };
  if (attempt.outcome === "ERROR" && record.retries < maxRetries && /BINDING_UNRESOLVED/.test(attempt.reason) === false) return { action: "retry", reason: `error before observation (${attempt.reason}); retry ${record.retries + 1}/${maxRetries}` };
  return { action: "replan", reason: `${failureClass} failure (${attempt.reason}); switching capability` };
}
