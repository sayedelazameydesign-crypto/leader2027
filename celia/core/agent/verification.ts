/**
 * Celia · core/agent · **تحقق الخطوة** (GEN-2): FAILED (الفعل نفسه لم ينجح: رفض/خطأ/ملاحظة غير ok)
 * مقابل NOT_VERIFIED (نُفّذ لكن التوقّع لم يتحقق) مقابل VERIFIED. التفريق يقود آلة الحالة: FAILED → RECOVERING، NOT_VERIFIED → REPLANNING.
 */
import type { PlanStep, StepVerdict } from "../task/index.ts";
import type { StepObservation } from "./observation.ts";
import { checkExpectation } from "./plan.ts";

export type StepVerification = { verdict: StepVerdict; reasons: string[] };

export function verifyStep(step: PlanStep, obs: StepObservation | null, error: string | null): StepVerification {
  if (!obs) return { verdict: "FAILED", reasons: [error ?? "no observation"] };
  if (obs.outcome === "DENIED") return { verdict: "FAILED", reasons: [`denied at ${obs.deniedAt}: ${obs.reason ?? "-"}`] };
  if ((step.expect.ok ?? true) && !obs.ok) return { verdict: "FAILED", reasons: [`observation not ok: ${obs.summary}`] };
  const exp = checkExpectation(step.expect, obs, obs.data);
  if (!exp.ok) return { verdict: "NOT_VERIFIED", reasons: exp.reasons };
  return { verdict: "VERIFIED", reasons: [] };
}
