/**
 * Celia · core/agent · **حلقة القرار** (GEN-2 + GEN-3) — آلة الحالة تعمل هنا، ولا تعمل في أي مكان آخر.
 *
 *   UNDERSTAND → OUTCOME CONTRACT → PLAN → CAPABILITY SELECTION → [precheck ⇒ WAITING_APPROVAL?]
 *   → gateway.submit (= NEXA precheck + execution gate) → OBSERVE → VERIFY → (READY | RECOVERING | REPLANNING)
 *   → … → VERIFYING(العقد يحكم) ⇒ COMPLETED | PARTIAL | BLOCKED | FAILED
 *
 * GEN-3: الحلقة **قابلة للاستئناف من أي نقطة تفتيش**: كل دورة تقرأ `task.state` وتنفّذ انتقالًا واحدًا (أو أكثر) ثم تلتزم
 * (نقطة تفتيش + دليل + لقطة) في معاملة واحدة. انقطاع بعد EXECUTING وقبل ملاحظة مسجّلة = محاولة INTERRUPTED: القراءة تُعاد،
 * وغير القراءة يُغلق fail-closed. WAITING_APPROVAL يوقف الحلقة ويعيد المهمة؛ الاستئناف يعيد التحقق من تطابق
 * proposalHash + operation + costCap قبل الرجوع إلى READY.
 *
 * قواعد صلبة: لا فعل إلا عبر `ctx.gateway.submit`؛ COMPLETED/PARTIAL لا يُبلَغان إلا من VERIFYING؛ الإنهاء مضمون بالسقوف.
 */
import { NexaError, type Facts } from "../../nexa/index.ts";
import {
  computeOutcome,
  factsFromSteps,
  isBinding,
  isTerminal,
  makeArtifact,
  newStepRecord,
  transition,
  type ApprovalRequest,
  type CapabilityChoice,
  type StepAttempt,
  type StepRecord,
  type Task,
  type TaskState,
} from "../task/index.ts";
import type { AgentContext } from "./context.ts";
import type { Understanding } from "./intent.ts";
import { observe, type StepObservation } from "./observation.ts";
import { resolveArguments, selectPath } from "./plan.ts";
import type { Planner } from "./planner.ts";
import { decideRecovery } from "./recovery.ts";
import { replan } from "./replan.ts";
import { verifyStep } from "./verification.ts";

export type LoopDeps = { understanding: Understanding; planner: Planner };

/** حقائق تقيسها البوابة لا الوكيل: هل وقع إنفاق؟ هل هناك نداء خارج البوابة (في هذه العملية)؟ */
export function gatewayFacts(ctx: AgentContext, previous: Facts = {}): Facts {
  const stats = ctx.gateway.stats();
  const receipts = ctx.gateway.receipts();
  const paid = receipts.some((r) => r.outcome === "EXECUTED" && ((r.observation?.costUsd ?? 0) > 0 || r.reservationId !== null));
  const transport = ctx.transportCalls?.();
  const ungated = transport === undefined ? "unknown" : transport !== stats.executed;
  return {
    paid_use: previous.paid_use === true || paid,
    ungated_action: previous.ungated_action === true ? true : ungated === "unknown" ? (previous.ungated_action ?? "unknown") : ungated,
  };
}

/** الخطوات التي تربط وسائطها بخطوة معيّنة (تعدّيًا) — تُحجب معها عندما تُحجب. */
export function dependentsOf(steps: readonly StepRecord[], stepId: string): string[] {
  const binds = (c: CapabilityChoice, id: string): boolean => {
    const walk = (v: unknown): boolean => (isBinding(v) ? v.$bind === id || v.$bind.startsWith(`${id}.`) : Array.isArray(v) ? v.some(walk) : v !== null && typeof v === "object" ? Object.values(v as Record<string, unknown>).some(walk) : false);
    return walk(c.arguments);
  };
  const out = new Set<string>();
  const queue = [stepId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of steps) {
      if (r.step.id === cur || out.has(r.step.id) || r.status !== "PENDING") continue;
      if (r.step.candidates.some((c) => binds(c, cur))) {
        out.add(r.step.id);
        queue.push(r.step.id);
      }
    }
  }
  return [...out];
}

const shortSteps = (steps: readonly StepRecord[]): string => steps.map((r) => `${r.step.id}:${r.status}`).join(",");

export async function runDecisionLoop(task: Task, ctx: AgentContext, deps: LoopDeps): Promise<Task> {
  const graph = ctx.gateway.graph;
  const head = (): string => graph.stats().head;
  let persistedEntries = ctx.store ? ctx.store.evidence(task.id).length : 0;
  const process_ = { seq: task.processes.length + 1, mode: ctx.mode, startedAt: ctx.now(), endedAt: null as string | null, executed: 0, transportCalls: null as number | null, fromState: task.state, toState: null as TaskState | null };
  task.processes.push(process_);

  /** الانتقال الملتزَم: نقطة تفتيش + مدخلات الدليل الجديدة + لقطة المهمة في معاملة واحدة، ثم الخطّاف. */
  const go = (to: TaskState, note: string, stepId: string | null = null): void => {
    const commit = (): void => {
      // سجل العملية يُحدَّث عند كل التزام — فإن ماتت العملية بقي آخر ما ثبت (تنفيذات = نقل) لا صفرًا.
      process_.executed = ctx.gateway.stats().executed;
      process_.transportCalls = ctx.transportCalls?.() ?? null;
      transition(task, to, { at: ctx.now(), note, evidenceHead: head(), checkpoints: ctx.checkpoints, stepId });
      if (ctx.store) {
        const entries = graph.entriesSnapshot();
        if (entries.length > persistedEntries) ctx.store.appendEvidence(task.id, entries.slice(persistedEntries));
        persistedEntries = entries.length;
        ctx.store.saveTask(task);
      }
    };
    if (ctx.store) ctx.store.transaction(commit);
    else commit();
    ctx.onTransition?.(task, to);
  };
  const baseFacts = (): Facts => ({ ...ctx.facts, ...gatewayFacts(ctx, task.facts) });
  const finalizeOutcome = (): void => {
    if (!task.contract) return;
    task.facts = factsFromSteps(task.steps, baseFacts());
    task.outcome = computeOutcome(task.contract, task.facts);
  };
  const end = (state: "COMPLETED" | "PARTIAL" | "BLOCKED" | "FAILED", note: string, stepId: string | null = null): Task => {
    finalizeOutcome();
    const vid = `verification:${task.id}:outcome`;
    if (!graph.getNode(vid)) graph.verification(task.id, vid, ctx.now(), { from: task.state, final: state, outcome: task.outcome, facts: task.facts, replans: task.replans, attempts: task.attempts, steps: shortSteps(task.steps), blockedReason: task.blockedReason });
    go(state, note, stepId);
    return task;
  };
  const running = (): StepRecord | undefined => task.steps.find((r) => r.status === "RUNNING");
  const nextPending = (): StepRecord | undefined => task.steps.find((r) => r.status === "PENDING");
  const observationsData = (): Record<string, unknown> => Object.fromEntries(task.steps.filter((r) => r.status === "VERIFIED").map((r) => [r.step.id, r.data]));
  const requestOf = (record: StepRecord, candidate: CapabilityChoice) => {
    const { args } = resolveArguments(candidate.arguments, observationsData());
    return {
      intentId: task.intent!.id,
      agentId: ctx.agentId,
      capability: candidate.capability,
      operation: candidate.operation,
      arguments: args,
      risk: candidate.risk,
      dataClass: candidate.dataClass,
      maxCostUsd: candidate.maxCostUsd ?? 0,
      proposedBy: `agent:${ctx.agentId}/planner`,
      stepId: record.step.id,
    };
  };
  const recordPlan = (version: number, ok: boolean, data: Record<string, unknown>): void => {
    const actionId = `action:${task.id}:plan-v${version}`;
    if (graph.getNode(actionId)) return;
    graph.action(task.id, actionId, ctx.now(), { reason: ok ? `plan v${version}` : `plan v${version} rejected`, executor: "agent-core (strategy planner)", risk: "read" });
    graph.evidence(actionId, `evidence:${task.id}:plan-v${version}`, ctx.now(), data);
  };
  /** حجب خطوة بلا بديل، ومعها كل خطوة تعتمد عليها — ثم تُكمل الحلقة ما تبقّى ليحكم العقد (PARTIAL لا COMPLETED). */
  const blockStep = (record: StepRecord, reason: string): void => {
    record.status = "BLOCKED";
    for (const id of dependentsOf(task.steps, record.step.id)) {
      const dep = task.steps.find((r) => r.step.id === id)!;
      dep.status = "BLOCKED";
      dep.attempts.push({ seq: 0, stepId: id, planVersion: task.plan!.version, candidateIndex: -1, capability: "-", operation: "-", actionId: null, outcome: "ERROR", deniedAt: null, ok: false, verdict: "FAILED", reason: `dependency "${record.step.id}" blocked: ${reason}`, codes: [], retry: false, at: ctx.now(), evidenceHead: null });
    }
  };
  const finalState = (): "COMPLETED" | "PARTIAL" | "BLOCKED" | "FAILED" => {
    finalizeOutcome();
    const status = task.outcome!.status;
    if (status === "COMPLETED") return "COMPLETED";
    if (status === "PARTIAL") return "PARTIAL";
    if (status === "BLOCKED") return "BLOCKED";
    const anyBlocked = task.steps.some((r) => r.status === "BLOCKED");
    const anyFailed = task.steps.some((r) => r.status === "FAILED");
    return anyBlocked && !anyFailed ? "BLOCKED" : "FAILED";
  };
  const emitArtifacts = (record: StepRecord, obs: StepObservation): void => {
    for (const spec of record.step.artifacts ?? []) {
      let data = selectPath(obs.data, spec.from);
      if (data === undefined) continue;
      if (spec.limit !== undefined && Array.isArray(data)) data = data.slice(0, spec.limit);
      const artifact = makeArtifact({ id: `artifact:${task.id}:${record.step.id}:${spec.type}`, taskId: task.id, stepId: record.step.id, type: spec.type, ref: obs.actionId, evidenceHead: obs.evidenceHead, createdAt: ctx.now(), data });
      if (task.artifacts.some((a) => a.id === artifact.id)) continue;
      task.artifacts.push(artifact);
      ctx.store?.saveArtifact(artifact);
      graph.evidence(obs.actionId, `${obs.actionId}:artifact:${spec.type}`, ctx.now(), { artifactId: artifact.id, type: spec.type, evidenceHash: artifact.evidenceHash, size: JSON.stringify(data).length });
    }
  };

  // ملاحظة المحاولة الجارية في هذه العملية فقط — غيابها عند VERIFYING مع خطوة RUNNING = انقطاع.
  let pending: { obs: StepObservation | null; error: string | null } | null = null;
  let template: Awaited<ReturnType<Understanding["understand"]>> | null = null;
  // أول دورة بعد استئناف: إن كانت الحالة EXECUTING/OBSERVING/VERIFYING بلا ملاحظة في هذه العملية ⇒ انقطاع.
  let firstDispatch = true;
  const closeProcess = (): Task => {
    process_.endedAt = ctx.now();
    process_.executed = ctx.gateway.stats().executed;
    process_.transportCalls = ctx.transportCalls?.() ?? null;
    process_.toState = task.state;
    ctx.store?.saveTask(task);
    return task;
  };

  for (;;) {
    if (isTerminal(task.state)) return closeProcess();
    const resumedMidStep = firstDispatch && ctx.mode === "resume";
    firstDispatch = false;

    switch (task.state) {
      case "CREATED": {
        go("UNDERSTANDING", `understand goal "${task.goal.text.slice(0, 80)}"`);
        break;
      }

      // ── UNDERSTAND → OUTCOME CONTRACT ──────────────────────────────────────
      case "UNDERSTANDING": {
        const aid = `action:${task.id}:understand`;
        if (!graph.getNode(aid)) graph.action(task.id, aid, ctx.now(), { reason: "understand the goal and bind an outcome contract", executor: "agent-core (deterministic, template understanding)", risk: "read" });
        const u = await deps.understanding.understand(task.goal, ctx);
        if (!u.ok) {
          graph.evidence(aid, `evidence:${task.id}:intent-rejected`, ctx.now(), { code: u.code, reason: u.reason });
          task.blockedReason = `${u.code}: ${u.reason}`;
          end("BLOCKED", task.blockedReason);
          return closeProcess();
        }
        template = u;
        task.intent = u.intent;
        task.contract = u.intent.contract;
        if (!graph.getNode(`evidence:${task.id}:intent`)) graph.evidence(aid, `evidence:${task.id}:intent`, ctx.now(), { understoodBy: u.intent.understoodBy, strategyId: u.intent.strategyId, params: u.intent.params, contract: u.intent.contract });
        const preBlocked = computeOutcome(task.contract, { ...ctx.facts }).blocked;
        if (preBlocked.length) {
          task.blockedReason = `BLOCKER: ${preBlocked.join(",")} (known before planning)`;
          end("BLOCKED", task.blockedReason);
          return closeProcess();
        }
        go("PLANNING", `plan with strategy ${u.intent.strategyId}`);
        break;
      }

      // ── PLAN → CAPABILITY SELECTION ────────────────────────────────────────
      case "PLANNING": {
        if (!template) {
          const u = await deps.understanding.understand(task.goal, ctx);
          if (!u.ok) {
            task.blockedReason = `${u.code}: ${u.reason}`;
            end("BLOCKED", task.blockedReason);
            return closeProcess();
          }
          template = u;
          task.intent ??= u.intent;
          task.contract ??= u.intent.contract;
        }
        if (!task.plan) {
          const first = deps.planner.plan({ intent: task.intent!, strategy: template.template.strategy(task.intent!.params, ctx), ctx, reason: "initial plan" });
          if (!first.ok) {
            recordPlan(1, false, { reason: first.reason, rejected: first.rejected });
            task.blockedReason = `PLAN_INFEASIBLE: ${first.reason}`;
            end("BLOCKED", task.blockedReason);
            return closeProcess();
          }
          task.plan = first.plan;
          task.plans.push(first.plan);
          task.steps = first.plan.steps.map(newStepRecord);
          recordPlan(1, true, { hash: first.plan.hash, steps: first.plan.steps.map((s) => ({ id: s.id, establishes: s.establishes, candidates: s.candidates.map((c) => `${c.capability}/${c.operation}`) })), rejected: first.plan.rejected });
        }
        go("READY", `plan v${task.plan.version}: ${task.plan.steps.length} step(s), ${task.plan.rejected.length} candidate(s) rejected at planning`);
        break;
      }

      // ── READY: اختيار الخطوة/المرشح، فحص قبلي، ثم EXECUTING أو WAITING_APPROVAL أو VERIFYING(نهائي) ──
      case "READY": {
        if (task.attempts >= ctx.limits.maxAttempts) {
          go("VERIFYING", `attempt budget ${ctx.limits.maxAttempts} exhausted: evaluate what was established`);
          break;
        }
        const record = running() ?? nextPending();
        if (!record) {
          go("VERIFYING", "all steps settled: evaluate the outcome contract");
          break;
        }
        const step = record.step;
        const candidate = step.candidates[record.candidateIndex]!;
        const retry = record.retries > 0;
        if (ctx.approvals) {
          let pre: ReturnType<typeof ctx.gateway.precheck> | null = null;
          try {
            pre = ctx.gateway.precheck(requestOf(record, candidate));
          } catch {
            pre = null; // ربط غير محلول ⇒ يُعالج كمحاولة ERROR في EXECUTING
          }
          if (pre?.needsApproval) {
            const approval = ctx.approvals.request({ taskId: task.id, stepId: step.id, capability: candidate.capability, operation: candidate.operation, proposalHash: pre.proposalHash, costCap: candidate.maxCostUsd ?? 0, risk: candidate.risk, reason: `${pre.reason ?? "approval required"} [${pre.codes.join(",")}]`, now: ctx.now(), ttlMs: ctx.approvalTtlMs });
            task.pendingApprovalId = approval.id;
            if (!task.approvals.some((a) => a.id === approval.id)) task.approvals.push(approval);
            record.status = "RUNNING";
            graph.evidence(`action:${task.id}:plan-v${task.plan!.version}`, `evidence:${task.id}:${approval.id}`, ctx.now(), { stepId: step.id, capability: candidate.capability, operation: candidate.operation, proposalHash: approval.proposalHash, costCap: approval.costCap, codes: pre.codes, expiresAt: approval.expiresAt });
            go("WAITING_APPROVAL", `step ${step.id}: ${candidate.capability}/${candidate.operation} requires a human grant (${pre.codes.join(",") || pre.reason}) — approval ${approval.id}`, step.id);
            return closeProcess();
          }
        }
        record.status = "RUNNING";
        go("EXECUTING", `step ${step.id}: ${candidate.capability}/${candidate.operation} (candidate ${record.candidateIndex + 1}/${step.candidates.length}${retry ? `, retry ${record.retries}` : ""})`, step.id);
        break;
      }

      // ── ACT (الفعل الوحيد: اقتراح إلى البوابة) ─────────────────────────────
      case "EXECUTING": {
        const record = running();
        if (!record) throw new NexaError("LOOP_INVARIANT", "EXECUTING without a running step");
        if (resumedMidStep) {
          // انقطاع: العملية السابقة ماتت بعد EXECUTING — لا نعرف هل نُودي المزوّد. يُسجَّل كما هو.
          pending = { obs: null, error: "INTERRUPTED: process ended after EXECUTING and before an observation was recorded" };
          task.attempts++;
          go("OBSERVING", `no receipt: ${pending.error}`, record.step.id);
          break;
        }
        const candidate = record.step.candidates[record.candidateIndex]!;
        task.attempts++;
        let obs: StepObservation | null = null;
        let error: string | null = null;
        try {
          const receipt = await ctx.gateway.submit(requestOf(record, candidate));
          obs = observe(receipt, ctx.parseResult);
        } catch (e) {
          error = e instanceof Error ? `${e.name}${"code" in e ? `[${String((e as { code: unknown }).code)}]` : ""}: ${e.message}` : String(e);
        }
        pending = { obs, error };
        go("OBSERVING", obs ? `${obs.actionId}: ${obs.outcome}${obs.deniedAt ? `@${obs.deniedAt}` : ""} ok=${obs.ok} verified=${obs.verified}` : `no receipt: ${error}`, record.step.id);
        break;
      }

      case "OBSERVING": {
        const record = running();
        if (!record) throw new NexaError("LOOP_INVARIANT", "OBSERVING without a running step");
        if (pending === null) {
          pending = { obs: null, error: "INTERRUPTED: process ended before the observation was verified" };
          task.attempts++;
        }
        go("VERIFYING", `verify step ${record.step.id} against its expectation`, record.step.id);
        break;
      }

      // ── VERIFY: خطوة جارية ⇒ حكم الخطوة؛ لا خطوة جارية ⇒ حكم العقد (نهائي) ──
      case "VERIFYING": {
        const record = running();
        if (!record) {
          const state = finalState();
          const o = task.outcome!;
          end(state, `outcome ${o.status}: met=${o.met.join(",") || "-"} unmet=${o.unmet.join(",") || "-"} unknown=${o.unknown.join(",") || "-"} violated=${o.violated.join(",") || "-"} blocked=${o.blocked.join(",") || "-"}`);
          return closeProcess();
        }
        const step = record.step;
        const candidate = step.candidates[record.candidateIndex]!;
        if (pending === null) {
          pending = { obs: null, error: "INTERRUPTED: process ended before the step verdict was recorded" };
          task.attempts++;
        }
        const { obs, error } = pending;
        pending = null;
        const v = verifyStep(step, obs, error);
        const attempt: StepAttempt = {
          seq: task.attempts,
          stepId: step.id,
          planVersion: task.plan!.version,
          candidateIndex: record.candidateIndex,
          capability: candidate.capability,
          operation: candidate.operation,
          actionId: obs?.actionId ?? null,
          outcome: obs ? obs.outcome : error?.startsWith("INTERRUPTED") ? "INTERRUPTED" : "ERROR",
          deniedAt: obs?.deniedAt ?? null,
          ok: obs?.ok ?? false,
          verdict: v.verdict,
          reason: v.reasons.join(" | ") || "-",
          codes: obs?.codes ?? [],
          retry: record.retries > 0,
          at: ctx.now(),
          evidenceHead: obs?.evidenceHead ?? null,
        };
        if (v.verdict === "FAILED") {
          attempt.failureClass = attempt.outcome === "INTERRUPTED" ? (candidate.risk === "read" ? "transient" : "permanent") : obs && obs.outcome === "EXECUTED" && ctx.classifyFailure ? ctx.classifyFailure(candidate.capability, obs.raw) : "permanent";
        }
        record.attempts.push(attempt);
        if (obs) graph.verification(obs.actionId, `${obs.actionId}:step`, ctx.now(), { stepId: step.id, verdict: v.verdict, reasons: v.reasons, establishes: step.establishes });
        if (v.verdict === "VERIFIED") {
          record.status = "VERIFIED";
          record.data = obs!.data;
          emitArtifacts(record, obs!);
          task.facts = factsFromSteps(task.steps, baseFacts());
          go("READY", `step ${step.id} verified by ${obs!.actionId}; establishes ${step.establishes.join(",") || "-"}`, step.id);
          break;
        }
        if (v.verdict === "FAILED") {
          go("RECOVERING", `step ${step.id} failed: ${attempt.reason}`, step.id);
          break;
        }
        go("REPLANNING", `step ${step.id}: not verified: ${attempt.reason}`, step.id);
        break;
      }

      // ── RECOVER: إعادة عابرة للمرشح نفسه، أو إعادة تخطيط، أو إغلاق ─────────
      case "RECOVERING": {
        const record = running();
        const attempt = record?.attempts.at(-1);
        if (!record || !attempt) throw new NexaError("LOOP_INVARIANT", "RECOVERING without a running step attempt");
        const candidate = record.step.candidates[record.candidateIndex]!;
        const d = attempt.outcome === "INTERRUPTED" && candidate.risk !== "read"
          ? { action: "fail" as const, reason: `interrupted non-idempotent ${candidate.risk} action: manual reconciliation required before any retry` }
          : decideRecovery(record, attempt, ctx.limits, attempt.failureClass ?? "permanent");
        if (d.action === "retry" && task.attempts >= ctx.limits.maxAttempts) {
          record.status = "FAILED";
          end("FAILED", `attempt budget ${ctx.limits.maxAttempts} exhausted`, record.step.id);
          return closeProcess();
        }
        if (d.action === "retry") {
          record.retries++;
          go("EXECUTING", `step ${record.step.id}: ${candidate.capability}/${candidate.operation} (candidate ${record.candidateIndex + 1}/${record.step.candidates.length}, retry ${record.retries}: ${d.reason})`, record.step.id);
          break;
        }
        if (d.action === "fail") {
          record.status = "FAILED";
          end("FAILED", d.reason, record.step.id);
          return closeProcess();
        }
        go("REPLANNING", `step ${record.step.id}: ${d.reason}`, record.step.id);
        break;
      }

      // ── REPLAN: إصدار خطة جديد أو حجب الخطوة (ومن يعتمد عليها) ────────────
      case "REPLANNING": {
        const record = running();
        if (!record) throw new NexaError("LOOP_INVARIANT", "REPLANNING without a running step");
        const reason = (task.history.at(-1)?.note ?? "replan").replace(new RegExp(`^step ${record.step.id}: `), "");
        if (task.replans >= ctx.limits.maxReplans) {
          record.status = "FAILED";
          end("FAILED", `replan budget ${ctx.limits.maxReplans} exhausted at step ${record.step.id}`, record.step.id);
          return closeProcess();
        }
        task.replans++;
        const r = replan(task, ctx, deps.planner, record.step.id, reason);
        if (!r.ok) {
          recordPlan(task.plan!.version + 1, false, { reason: r.reason });
          blockStep(record, r.reason);
          task.blockedReason = r.reason;
          go("READY", `step ${record.step.id} blocked (${r.reason.slice(0, 120)}); continuing with what remains`, record.step.id);
          break;
        }
        task.plan = r.plan;
        task.plans.push(r.plan);
        task.steps = r.steps;
        recordPlan(r.plan.version, true, { hash: r.plan.hash, reason: r.plan.reason, steps: r.plan.steps.map((s) => ({ id: s.id, candidates: s.candidates.map((c) => `${c.capability}/${c.operation}`) })), rejected: r.plan.rejected });
        go("READY", `plan v${r.plan.version}: ${r.plan.reason}`, record.step.id);
        break;
      }

      // ── WAITING_APPROVAL: منح بشري معلّق — الحلقة تقف؛ الاستئناف يعيد التحقق من التطابق ──
      case "WAITING_APPROVAL": {
        const record = running();
        const approvals = ctx.approvals;
        if (!record || !approvals || !task.pendingApprovalId) throw new NexaError("LOOP_INVARIANT", "WAITING_APPROVAL without a pending approval");
        approvals.expireDue(ctx.now());
        const a: ApprovalRequest | null = approvals.get(task.pendingApprovalId);
        if (!a) throw new NexaError("LOOP_INVARIANT", `approval ${task.pendingApprovalId} vanished`);
        const idx = task.approvals.findIndex((x) => x.id === a.id);
        if (idx >= 0) task.approvals[idx] = a;
        else task.approvals.push(a);
        if (a.status === "pending") return closeProcess(); // ما زال معلّقًا: نخرج ونستأنف لاحقًا
        task.pendingApprovalId = null;
        const candidate = record.step.candidates[record.candidateIndex]!;
        if (a.status === "approved") {
          const pre = ctx.gateway.precheck(requestOf(record, candidate));
          const bound = pre.proposalHash === a.proposalHash && candidate.operation === a.operation && (candidate.maxCostUsd ?? 0) <= a.costCap;
          if (bound && pre.ok) {
            ctx.store?.audit({ taskId: task.id, at: ctx.now(), event: "approval.resumed", data: { id: a.id, grantId: a.grantId } });
            go("READY", `approval ${a.id} approved by ${a.decidedBy}; proposal hash, operation and cost cap re-verified`, record.step.id);
            break;
          }
          ctx.store?.audit({ taskId: task.id, at: ctx.now(), event: "approval.mismatch", data: { id: a.id, expected: a.proposalHash, actual: pre.proposalHash, stage: pre.stage } });
          record.attempts.push({ seq: 0, stepId: record.step.id, planVersion: task.plan!.version, candidateIndex: record.candidateIndex, capability: candidate.capability, operation: candidate.operation, actionId: null, outcome: "DENIED", deniedAt: "APPROVAL", ok: false, verdict: "FAILED", reason: bound ? `approval ${a.id} no longer admissible at ${pre.stage}: ${pre.reason}` : `approval ${a.id} does not match the proposal (hash/operation/cost cap)`, codes: pre.codes, retry: false, at: ctx.now(), evidenceHead: null });
          go("REPLANNING", `approval ${a.id}: ${bound ? "no longer admissible" : "binding mismatch"} ⇒ denied`, record.step.id);
          break;
        }
        record.attempts.push({ seq: 0, stepId: record.step.id, planVersion: task.plan!.version, candidateIndex: record.candidateIndex, capability: candidate.capability, operation: candidate.operation, actionId: null, outcome: "DENIED", deniedAt: "APPROVAL", ok: false, verdict: "FAILED", reason: `approval ${a.id} ${a.status}${a.decision ? `: ${a.decision}` : ""}`, codes: [], retry: false, at: ctx.now(), evidenceHead: null });
        go("REPLANNING", `approval ${a.id} ${a.status}: switching capability if any`, record.step.id);
        break;
      }

      default:
        throw new NexaError("LOOP_INVARIANT", `unhandled state ${String(task.state)}`);
    }
  }

}
