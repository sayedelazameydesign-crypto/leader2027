/**
 * Celia · core/agent · **حلقة القرار** (GEN-2) — آلة الحالة تعمل هنا، ولا تعمل في أي مكان آخر.
 *
 *   UNDERSTAND → OUTCOME CONTRACT → PLAN → CAPABILITY SELECTION → [NEXA precheck + execution gate = gateway.submit]
 *   → ACT → OBSERVE → VERIFY → (READY | RECOVERING | REPLANNING) → … → COMPLETED / BLOCKED / FAILED
 *
 * قواعد صلبة:
 *   - لا فعل إلا عبر `ctx.gateway.submit` (اقتراح) — لا مسار شبكي مباشر، ولا في إعادة التخطيط.
 *   - COMPLETED لا يُبلَغ إلا بعد أن يحكم عقد النتيجة (VERIFYING) — الوكيل لا يقول «تم».
 *   - الإنهاء مضمون: سقف محاولات، سقف إعادات تخطيط، سقف إعادات محاولة لكل خطوة.
 */
import type { Facts } from "../../nexa/index.ts";
import { computeOutcome, factsFromSteps, newStepRecord, transition, type StepAttempt, type StepRecord, type Task } from "../task/index.ts";
import type { AgentContext } from "./context.ts";
import type { Understanding } from "./intent.ts";
import { observe, type StepObservation } from "./observation.ts";
import { resolveArguments } from "./plan.ts";
import type { Planner } from "./planner.ts";
import { decideRecovery } from "./recovery.ts";
import { replan } from "./replan.ts";
import { verifyStep } from "./verification.ts";

export type LoopDeps = { understanding: Understanding; planner: Planner };

/** حقائق تقيسها البوابة لا الوكيل: هل وقع إنفاق؟ هل هناك نداء خارج البوابة؟ */
export function gatewayFacts(ctx: AgentContext): Facts {
  const stats = ctx.gateway.stats();
  const receipts = ctx.gateway.receipts();
  const paid = receipts.some((r) => r.outcome === "EXECUTED" && ((r.observation?.costUsd ?? 0) > 0 || r.reservationId !== null));
  const transport = ctx.transportCalls?.();
  return { paid_use: paid, ungated_action: transport === undefined ? "unknown" : transport !== stats.executed };
}

const shortSteps = (steps: readonly StepRecord[]): string => steps.map((r) => `${r.step.id}:${r.status}`).join(",");

export async function runDecisionLoop(task: Task, ctx: AgentContext, deps: LoopDeps): Promise<Task> {
  const graph = ctx.gateway.graph;
  const head = (): string => graph.stats().head;
  const go = (to: Parameters<typeof transition>[1], note: string, stepId: string | null = null): void => {
    transition(task, to, { at: ctx.now(), note, evidenceHead: head(), checkpoints: ctx.checkpoints, stepId });
  };
  const finalizeOutcome = (): void => {
    if (!task.contract) return;
    task.facts = factsFromSteps(task.steps, { ...ctx.facts, ...gatewayFacts(ctx) });
    task.outcome = computeOutcome(task.contract, task.facts);
  };
  const end = (state: "COMPLETED" | "BLOCKED" | "FAILED", note: string, stepId: string | null = null): Task => {
    finalizeOutcome();
    graph.verification(task.id, `verification:${task.id}:outcome`, ctx.now(), { from: task.state, final: state, outcome: task.outcome, facts: task.facts, replans: task.replans, attempts: task.attempts, steps: shortSteps(task.steps), blockedReason: task.blockedReason });
    go(state, note, stepId);
    return task;
  };

  // ── UNDERSTAND → OUTCOME CONTRACT ─────────────────────────────────────────────
  go("UNDERSTANDING", `understand goal "${task.goal.text.slice(0, 80)}"`);
  graph.action(task.id, `action:${task.id}:understand`, ctx.now(), { reason: "understand the goal and bind an outcome contract", executor: "agent-core (deterministic, template understanding)", risk: "read" });
  const u = await deps.understanding.understand(task.goal, ctx);
  if (!u.ok) {
    graph.evidence(`action:${task.id}:understand`, `evidence:${task.id}:intent-rejected`, ctx.now(), { code: u.code, reason: u.reason });
    task.blockedReason = `${u.code}: ${u.reason}`;
    return end("BLOCKED", task.blockedReason);
  }
  task.intent = u.intent;
  task.contract = u.intent.contract;
  graph.evidence(`action:${task.id}:understand`, `evidence:${task.id}:intent`, ctx.now(), { understoodBy: u.intent.understoodBy, strategyId: u.intent.strategyId, params: u.intent.params, contract: u.intent.contract });
  // عوائق معروفة مسبقًا (مثل غياب السرّ) توقف المهمة قبل أي تخطيط أو تنفيذ — لا محاولة «لنرى».
  const preBlocked = computeOutcome(task.contract, { ...ctx.facts }).blocked;
  if (preBlocked.length) {
    task.blockedReason = `BLOCKER: ${preBlocked.join(",")} (known before planning)`;
    return end("BLOCKED", task.blockedReason);
  }

  // ── PLAN → CAPABILITY SELECTION ───────────────────────────────────────────────
  go("PLANNING", `plan with strategy ${u.intent.strategyId}`);
  const recordPlan = (version: number, ok: boolean, data: Record<string, unknown>): void => {
    const actionId = `action:${task.id}:plan-v${version}`;
    graph.action(task.id, actionId, ctx.now(), { reason: ok ? `plan v${version}` : `plan v${version} rejected`, executor: "agent-core (strategy planner)", risk: "read" });
    graph.evidence(actionId, `evidence:${task.id}:plan-v${version}`, ctx.now(), data);
  };
  const first = deps.planner.plan({ intent: u.intent, strategy: u.template.strategy(u.intent.params, ctx), ctx, reason: "initial plan" });
  if (!first.ok) {
    recordPlan(1, false, { reason: first.reason, rejected: first.rejected });
    task.blockedReason = `PLAN_INFEASIBLE: ${first.reason}`;
    return end("BLOCKED", task.blockedReason);
  }
  task.plan = first.plan;
  task.plans.push(first.plan);
  task.steps = first.plan.steps.map(newStepRecord);
  recordPlan(1, true, { hash: first.plan.hash, steps: first.plan.steps.map((s) => ({ id: s.id, establishes: s.establishes, candidates: s.candidates.map((c) => `${c.capability}/${c.operation}`) })), rejected: first.plan.rejected });
  go("READY", `plan v1: ${first.plan.steps.length} step(s), ${first.plan.rejected.length} candidate(s) rejected at planning`);

  // ── ACT → OBSERVE → VERIFY → (READY | RECOVERING | REPLANNING) ─────────────────
  for (;;) {
    if (task.attempts >= ctx.limits.maxAttempts) {
      if (task.state === "READY") go("VERIFYING", `attempt budget ${ctx.limits.maxAttempts} exhausted: evaluate what was established`);
      return end("FAILED", `attempt budget ${ctx.limits.maxAttempts} exhausted`);
    }
    const record = task.steps.find((r) => r.status === "PENDING" || r.status === "RUNNING");
    if (!record) {
      go("VERIFYING", "all steps verified: evaluate the outcome contract");
      finalizeOutcome();
      const status = task.outcome!.status;
      if (status === "COMPLETED") return end("COMPLETED", `outcome COMPLETED: met=${task.outcome!.met.join(",")}`);
      if (status === "BLOCKED") return end("BLOCKED", `outcome BLOCKED: ${task.outcome!.blocked.join(",")}`);
      return end("FAILED", `outcome ${status}: unmet=${task.outcome!.unmet.join(",") || "-"} unknown=${task.outcome!.unknown.join(",") || "-"} violated=${task.outcome!.violated.join(",") || "-"}`);
    }
    const step = record.step;
    const candidate = step.candidates[record.candidateIndex]!;
    const retry = record.status === "RUNNING";
    record.status = "RUNNING";
    go("EXECUTING", `step ${step.id}: ${candidate.capability}/${candidate.operation} (candidate ${record.candidateIndex + 1}/${step.candidates.length}${retry ? `, retry ${record.retries}` : ""})`, step.id);
    task.attempts++;

    let obs: StepObservation | null = null;
    let error: string | null = null;
    try {
      const observations = Object.fromEntries(task.steps.filter((r) => r.status === "VERIFIED").map((r) => [r.step.id, r.data]));
      const { args } = resolveArguments(candidate.arguments, observations);
      const receipt = await ctx.gateway.submit({
        intentId: u.intent.id,
        agentId: ctx.agentId,
        capability: candidate.capability,
        operation: candidate.operation,
        arguments: args,
        risk: candidate.risk,
        dataClass: candidate.dataClass,
        maxCostUsd: candidate.maxCostUsd ?? ctx.defaults.maxCostUsd,
        proposedBy: `agent:${ctx.agentId}/planner`,
      });
      obs = observe(receipt, ctx.parseResult);
    } catch (e) {
      error = e instanceof Error ? `${e.name}${"code" in e ? `[${String((e as { code: unknown }).code)}]` : ""}: ${e.message}` : String(e);
    }
    go("OBSERVING", obs ? `${obs.actionId}: ${obs.outcome}${obs.deniedAt ? `@${obs.deniedAt}` : ""} ok=${obs.ok} verified=${obs.verified}` : `no receipt: ${error}`, step.id);
    go("VERIFYING", `verify step ${step.id} against its expectation`, step.id);
    const v = verifyStep(step, obs, error);
    const attempt: StepAttempt = {
      seq: task.attempts,
      stepId: step.id,
      planVersion: task.plan!.version,
      candidateIndex: record.candidateIndex,
      capability: candidate.capability,
      operation: candidate.operation,
      actionId: obs?.actionId ?? null,
      outcome: obs ? obs.outcome : "ERROR",
      deniedAt: obs?.deniedAt ?? null,
      ok: obs?.ok ?? false,
      verdict: v.verdict,
      reason: v.reasons.join(" | ") || "-",
      codes: obs?.codes ?? [],
      retry,
      at: ctx.now(),
      evidenceHead: obs?.evidenceHead ?? null,
    };
    record.attempts.push(attempt);
    if (obs) graph.verification(obs.actionId, `${obs.actionId}:step`, ctx.now(), { stepId: step.id, verdict: v.verdict, reasons: v.reasons, establishes: step.establishes });

    if (v.verdict === "VERIFIED") {
      record.status = "VERIFIED";
      record.data = obs!.data;
      task.facts = factsFromSteps(task.steps, { ...ctx.facts, ...gatewayFacts(ctx) });
      go("READY", `step ${step.id} verified by ${obs!.actionId}; establishes ${step.establishes.join(",") || "-"}`, step.id);
      continue;
    }

    let replanReason: string;
    if (v.verdict === "FAILED") {
      go("RECOVERING", `step ${step.id} failed: ${attempt.reason}`, step.id);
      const failureClass = obs && obs.outcome === "EXECUTED" && ctx.classifyFailure ? ctx.classifyFailure(obs.capability, obs.raw) : "permanent";
      const d = decideRecovery(record, attempt, ctx.limits, failureClass);
      if (d.action === "retry") {
        record.retries++;
        continue; // RECOVERING → EXECUTING at the loop head (same candidate)
      }
      if (d.action === "fail") {
        record.status = "FAILED";
        return end("FAILED", d.reason, step.id);
      }
      replanReason = d.reason;
    } else {
      replanReason = `not verified: ${attempt.reason}`;
    }

    go("REPLANNING", `step ${step.id}: ${replanReason}`, step.id);
    if (task.replans >= ctx.limits.maxReplans) {
      record.status = "FAILED";
      return end("FAILED", `replan budget ${ctx.limits.maxReplans} exhausted at step ${step.id}`, step.id);
    }
    task.replans++;
    const r = replan(task, ctx, deps.planner, step.id, replanReason);
    if (!r.ok) {
      record.status = "BLOCKED";
      recordPlan(task.plan!.version + 1, false, { reason: r.reason });
      task.blockedReason = r.reason;
      return end("BLOCKED", r.reason, step.id);
    }
    task.plan = r.plan;
    task.plans.push(r.plan);
    task.steps = r.steps;
    recordPlan(r.plan.version, true, { hash: r.plan.hash, reason: r.plan.reason, steps: r.plan.steps.map((s) => ({ id: s.id, candidates: s.candidates.map((c) => `${c.capability}/${c.operation}`) })), rejected: r.plan.rejected });
    go("READY", `plan v${r.plan.version}: ${r.plan.reason}`, step.id);
  }
}
