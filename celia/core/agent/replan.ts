/**
 * Celia · core/agent · **إعادة التخطيط** (GEN-2): إصدار خطة جديد يُسقط المرشح المستنفَد للخطوة الفاشلة ويحتفظ بالخطوات المتحققة.
 * كل فعل في الخطة الجديدة يمرّ بالبوابة من جديد — لا تجاوز لـ NEXA أثناء الإعادة.
 */
import { newStepRecord, type Plan, type StepRecord, type Task } from "../task/index.ts";
import type { AgentContext } from "./context.ts";
import type { Planner } from "./planner.ts";

export type ReplanResult = { ok: true; plan: Plan; steps: StepRecord[] } | { ok: false; reason: string };

export function replan(task: Task, ctx: AgentContext, planner: Planner, failedStepId: string, reason: string): ReplanResult {
  const current = task.plan;
  const intent = task.intent;
  if (!current || !intent) return { ok: false, reason: "cannot replan without a plan and an intent" };
  const record = task.steps.find((r) => r.step.id === failedStepId);
  if (!record) return { ok: false, reason: `unknown step "${failedStepId}"` };
  const exhausted = record.step.candidates[record.candidateIndex];
  const remaining = record.step.candidates.filter((_, i) => i !== record.candidateIndex);
  if (!exhausted || remaining.length === 0) {
    return { ok: false, reason: `no alternative capability for step "${failedStepId}" after ${record.attempts.length} attempt(s): ${reason}` };
  }
  const strategy = current.steps.map((s) => (s.id === failedStepId ? { ...s, candidates: remaining } : s));
  const result = planner.plan({
    intent,
    strategy,
    ctx,
    previous: current,
    reason: `replan after step "${failedStepId}": ${reason}`,
    rejectedSeed: [{ stepId: failedStepId, capability: exhausted.capability, operation: exhausted.operation, reason: `exhausted: ${reason}` }],
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  const steps = result.plan.steps.map((s) => {
    const old = task.steps.find((r) => r.step.id === s.id);
    if (old && old.status === "VERIFIED") return { ...old, step: s };
    return { ...(old ?? newStepRecord(s)), step: s, status: "PENDING" as const, candidateIndex: 0, retries: 0 };
  });
  return { ok: true, plan: result.plan, steps };
}
