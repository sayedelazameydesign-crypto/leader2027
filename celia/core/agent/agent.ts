/**
 * Celia · core/agent · **الوكيل** (GEN-2 + GEN-3): يأخذ هدفًا، يبني مهمة، يشغّل حلقة القرار، ويعيد تقريرًا قابلًا للإعادة —
 * أو يستأنف مهمة محفوظة من آخر نقطة تفتيش بعد التحقق من سلامة سلاسلها.
 *
 * الوكيل لا يملك سلطة: يقترح عبر البوابة، وNEXA تقرر، والإنسان يمنح، والدليل يثبت. الوكيل ≠ نموذج: في GEN-2/3 الفهم والتخطيط
 * حتميان (قوالب استراتيجية)؛ Model Mesh لاحقًا يطبّق الواجهتين `Understanding`/`Planner` دون أن يلمس البوابة.
 */
import { EvidenceGraph, ExecutionGateway, NexaError, receiptSummary, type Entry, type Facts, type GatewayStats } from "../../nexa/index.ts";
import { StoreCheckpoints, createTask, publicArtifact, verifyCheckpoints, type ApprovalRequest, type Artifact, type AuditEvent, type Checkpoint, type Goal, type StepRecord, type Task, type TaskStore } from "../task/index.ts";
import type { AgentContext } from "./context.ts";
import { gatewayFacts, runDecisionLoop } from "./decision-loop.ts";
import type { Understanding } from "./intent.ts";
import { StrategyPlanner, type Planner } from "./planner.ts";

export type SerializedStep = Omit<StepRecord, "data"> & { data: { shape: string; keys?: string[]; length?: number } | null };
export type SerializedTask = Omit<Task, "steps" | "artifacts"> & { steps: SerializedStep[]; artifacts: ReturnType<typeof publicArtifact>[] };

export type AgentRunReport = {
  generated_at: string;
  agent: string;
  task: SerializedTask;
  checkpoints: Checkpoint[];
  receipts: Record<string, unknown>[];
  gateway: GatewayStats & { transport_calls: number | null; ungated_calls: number | null };
  base_facts: Facts;
  graph: Entry[];
  approvals: ApprovalRequest[];
  audit: AuditEvent[];
  lines: string[];
};

/** شكل البيانات بلا قيم — للتقرير العام. */
export function shapeOf(data: unknown): SerializedStep["data"] {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return { shape: "array", length: data.length };
  if (typeof data === "object") return { shape: "object", keys: Object.keys(data as Record<string, unknown>).slice(0, 12) };
  return { shape: typeof data };
}

export function serializeTask(task: Task): SerializedTask {
  return { ...task, steps: task.steps.map((r) => ({ ...r, data: shapeOf(r.data) })), artifacts: task.artifacts.map(publicArtifact) };
}

export type ResumeLoad = { task: Task; graph: EvidenceGraph; entries: Entry[]; checkpoints: Checkpoint[]; startSeq: number; artifacts: Artifact[] };

/**
 * تحميل مهمة للاستئناف: يعيد سلسلة نقاط التفتيش وسلسلة الدليل ويربطهما بحالة المهمة **قبل** أي خطوة —
 * أي تلاعب أو فجوة ⇒ RESUME_INTEGRITY، لا استئناف صامت.
 */
export function loadTaskForResume(store: TaskStore, taskId: string): ResumeLoad {
  const task = store.loadTask(taskId);
  if (!task) throw new NexaError("RESUME_UNKNOWN_TASK", `no task ${taskId} in the store`);
  const checkpoints = store.checkpoints(taskId);
  const cps = verifyCheckpoints(checkpoints);
  if (!cps.ok) throw new NexaError("RESUME_INTEGRITY", `checkpoints: ${cps.reason}`);
  if (cps.final !== task.state) throw new NexaError("RESUME_INTEGRITY", `task snapshot says ${task.state} but the last checkpoint says ${cps.final}`);
  if (task.checkpointHead !== (checkpoints.at(-1)?.hash ?? null)) throw new NexaError("RESUME_INTEGRITY", "task snapshot does not point at the last checkpoint");
  const entries = store.evidence(taskId);
  const chain = EvidenceGraph.verifyEntries(entries);
  if (!chain.ok) throw new NexaError("RESUME_INTEGRITY", `evidence chain broken at ${chain.brokenAt}`);
  const heads = new Set(["0".repeat(64), ...entries.map((e) => e.hash)]);
  const missing = checkpoints.filter((c) => !heads.has(c.evidenceHead)).length;
  if (missing) throw new NexaError("RESUME_INTEGRITY", `${missing} checkpoint(s) reference an evidence head absent from the stored graph`);
  const graph = entries.length ? EvidenceGraph.fromEntries(entries).graph : new EvidenceGraph();
  if (entries.length && graph.stats().head !== task.evidenceChainHead) throw new NexaError("RESUME_INTEGRITY", "task snapshot does not point at the stored evidence head");
  task.artifacts = store.artifacts(taskId);
  return { task, graph, entries, checkpoints, startSeq: ExecutionGateway.lastActionSeq(graph), artifacts: task.artifacts };
}

export class Agent {
  private readonly planner: Planner;
  private readonly deps: { ctx: AgentContext; understanding: Understanding; planner?: Planner };
  constructor(deps: { ctx: AgentContext; understanding: Understanding; planner?: Planner }) {
    this.deps = deps;
    this.planner = deps.planner ?? new StrategyPlanner();
  }

  async run(goal: Goal): Promise<AgentRunReport> {
    const { ctx } = this.deps;
    ctx.mode = "run";
    if (ctx.store) {
      if (ctx.store.loadTask(ctx.taskId)) throw new NexaError("TASK_EXISTS", `task ${ctx.taskId} already exists in the store — resume it instead`);
      ctx.checkpoints = new StoreCheckpoints(ctx.store, ctx.taskId);
    }
    const task = ctx.store
      ? ctx.store.transaction(() => {
          const t = createTask(ctx.taskId, ctx.agentId, goal, ctx.now(), ctx.checkpoints, ctx.gateway.graph.stats().head);
          ctx.store!.appendEvidence(t.id, ctx.gateway.graph.entriesSnapshot());
          ctx.store!.saveTask(t);
          return t;
        })
      : createTask(ctx.taskId, ctx.agentId, goal, ctx.now(), ctx.checkpoints, ctx.gateway.graph.stats().head);
    await runDecisionLoop(task, ctx, { understanding: this.deps.understanding, planner: this.planner });
    return this.report(task);
  }

  /** استئناف مهمة محمّلة عبر `loadTaskForResume` (البوابة أُنشئت فوق رسم الدليل المحفوظ). */
  async resume(task: Task): Promise<AgentRunReport> {
    const { ctx } = this.deps;
    if (!ctx.store) throw new NexaError("RESUME_NO_STORE", "resume requires a task store");
    if (task.id !== ctx.taskId) throw new NexaError("RESUME_INTEGRITY", `context task ${ctx.taskId} != task ${task.id}`);
    ctx.mode = "resume";
    ctx.checkpoints = new StoreCheckpoints(ctx.store, task.id);
    await runDecisionLoop(task, ctx, { understanding: this.deps.understanding, planner: this.planner });
    return this.report(task);
  }

  private report(task: Task): AgentRunReport {
    const { ctx } = this.deps;
    const stats = ctx.gateway.stats();
    const transport = ctx.transportCalls?.() ?? null;
    const report: AgentRunReport = {
      generated_at: ctx.now(),
      agent: ctx.agentId,
      task: serializeTask(task),
      checkpoints: [...ctx.checkpoints.list()],
      receipts: ctx.gateway.receipts().map(receiptSummary),
      gateway: { ...stats, transport_calls: transport, ungated_calls: transport === null ? null : Math.max(0, transport - stats.executed) },
      base_facts: { ...ctx.facts, ...gatewayFacts(ctx, task.facts) },
      graph: ctx.gateway.graph.entriesSnapshot(),
      approvals: ctx.store ? ctx.store.approvalsFor(task.id) : task.approvals,
      audit: ctx.store ? ctx.store.auditLog(task.id) : [],
      lines: [],
    };
    report.lines = describeRun(report);
    return report;
  }
}

/** سطور دليل منقّحة (ASCII) — أسماء ومعرّفات وعدّادات فقط؛ لا قيم من المزوّد. */
export function describeRun(r: AgentRunReport): string[] {
  const t = r.task;
  const lines: string[] = [];
  lines.push(`AGENT: goal="${t.goal.text.replace(/[^\x20-\x7E]/g, "?").slice(0, 80)}" understood_by=${t.intent?.understoodBy ?? "-"} contract_required=[${t.contract?.required.join(",") ?? ""}] forbidden=[${t.contract?.forbidden.join(",") ?? ""}] cap_usd=${t.plan?.steps[0]?.candidates[0]?.maxCostUsd ?? 0} processes=${t.processes.length}`);
  for (const p of t.plans) lines.push(`PLAN v${p.version}: ${p.steps.map((s) => `${s.id}=[${s.candidates.map((c) => `${c.capability}/${c.operation}${c.arguments.anonymous === true ? "(anonymous)" : ""}`).join("|")}]`).join(" ")} rejected=${p.rejected.length}${p.version > 1 ? ` reason="${p.reason.slice(0, 100)}"` : ""} hash=${p.hash.slice(0, 12)}`);
  for (const s of t.steps) {
    for (const a of s.attempts) lines.push(`STEP ${s.step.id}: attempt ${a.seq || "-"} plan=v${a.planVersion} ${a.capability}/${a.operation} -> ${a.actionId ?? "no-receipt"} ${a.outcome}${a.deniedAt ? `@${a.deniedAt}` : ""} ok=${a.ok}${a.codes.length ? ` codes=${a.codes.join(",")}` : ""} => ${a.verdict}${a.verdict !== "VERIFIED" ? ` (${a.reason.slice(0, 120)})` : ""}`);
    lines.push(`STEP ${s.step.id}: status=${s.status} attempts=${s.attempts.length} retries=${s.retries} establishes=[${s.step.establishes.join(",")}]`);
  }
  for (const a of r.approvals) lines.push(`APPROVAL ${a.id}: step=${a.stepId} ${a.capability}/${a.operation} cost_cap=${a.costCap} status=${a.status}${a.decidedBy ? ` by=${a.decidedBy}` : ""} hash=${a.proposalHash.slice(0, 12)}`);
  for (const a of t.artifacts) lines.push(`ARTIFACT ${a.id}: type=${a.type} step=${a.stepId} ref=${a.ref} size=${a.size} hash=${a.evidenceHash.slice(0, 12)}`);
  lines.push(`STATES: ${t.history.map((h) => h.to).join(">")}`);
  lines.push(`PROCESSES: ${t.processes.map((p) => `${p.seq}:${p.mode}[${p.fromState}>${p.toState ?? "?"}] executed=${p.executed} transport=${p.transportCalls ?? "n/a"}`).join(" ")}`);
  lines.push(`GATEWAY: submitted=${r.gateway.submitted} executed=${r.gateway.executed} verified=${r.gateway.verified} denied=${Object.entries(r.gateway.denied).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(",") || "0"} transport_calls=${r.gateway.transport_calls ?? "n/a"} ungated_calls=${r.gateway.ungated_calls ?? "n/a"} checkpoints=${r.checkpoints.length} graph_entries=${r.graph.length}`);
  const o = t.outcome;
  lines.push(`OUTCOME: state=${t.state} outcome=${o?.status ?? "-"} met=[${o?.met.join(",") ?? ""}] unmet=[${o?.unmet.join(",") ?? ""}] unknown=[${o?.unknown.join(",") ?? ""}] violated=[${o?.violated.join(",") ?? ""}] blocked=[${o?.blocked.join(",") ?? ""}] replans=${t.replans} attempts=${t.attempts} artifacts=${t.artifacts.length}${t.pendingApprovalId ? ` waiting_for=${t.pendingApprovalId}` : ""}${t.blockedReason ? ` reason="${t.blockedReason.replace(/[^\x20-\x7E]/g, "?").slice(0, 160)}"` : ""}`);
  return lines;
}
