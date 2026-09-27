/**
 * Celia · core/agent · **الوكيل** (GEN-2): يأخذ هدفًا، يبني مهمة، يشغّل حلقة القرار، ويعيد تقريرًا قابلًا للإعادة.
 *
 * الوكيل لا يملك سلطة: يقترح عبر البوابة، وNEXA تقرر، والإنسان يمنح، والدليل يثبت. الوكيل ≠ نموذج: في GEN-2 الفهم والتخطيط
 * حتميان (قوالب استراتيجية)؛ Model Mesh لاحقًا يطبّق الواجهتين `Understanding`/`Planner` دون أن يلمس البوابة.
 */
import { receiptSummary, type Entry, type Facts, type GatewayStats } from "../../nexa/index.ts";
import { createTask, type Checkpoint, type Goal, type StepRecord, type Task } from "../task/index.ts";
import type { AgentContext } from "./context.ts";
import { gatewayFacts, runDecisionLoop } from "./decision-loop.ts";
import type { Understanding } from "./intent.ts";
import { StrategyPlanner, type Planner } from "./planner.ts";

export type SerializedStep = Omit<StepRecord, "data"> & { data: { shape: string; keys?: string[]; length?: number } | null };
export type SerializedTask = Omit<Task, "steps"> & { steps: SerializedStep[] };

export type AgentRunReport = {
  generated_at: string;
  agent: string;
  task: SerializedTask;
  checkpoints: Checkpoint[];
  receipts: Record<string, unknown>[];
  gateway: GatewayStats & { transport_calls: number | null; ungated_calls: number | null };
  base_facts: Facts;
  graph: Entry[];
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
  return { ...task, steps: task.steps.map((r) => ({ ...r, data: shapeOf(r.data) })) };
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
    const task = createTask(ctx.taskId, ctx.agentId, goal, ctx.now(), ctx.checkpoints, ctx.gateway.graph.stats().head);
    await runDecisionLoop(task, ctx, { understanding: this.deps.understanding, planner: this.planner });
    const stats = ctx.gateway.stats();
    const transport = ctx.transportCalls?.() ?? null;
    const report: AgentRunReport = {
      generated_at: ctx.now(),
      agent: ctx.agentId,
      task: serializeTask(task),
      checkpoints: [...ctx.checkpoints.list()],
      receipts: ctx.gateway.receipts().map(receiptSummary),
      gateway: { ...stats, transport_calls: transport, ungated_calls: transport === null ? null : Math.max(0, transport - stats.executed) },
      base_facts: { ...ctx.facts, ...gatewayFacts(ctx) },
      graph: ctx.gateway.graph.entriesSnapshot(),
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
  lines.push(`AGENT: goal="${t.goal.text.replace(/[^\x20-\x7E]/g, "?").slice(0, 80)}" understood_by=${t.intent?.understoodBy ?? "-"} contract_required=[${t.contract?.required.join(",") ?? ""}] forbidden=[${t.contract?.forbidden.join(",") ?? ""}] cap_usd=${t.plan?.steps[0]?.candidates[0]?.maxCostUsd ?? 0}`);
  for (const p of t.plans) lines.push(`PLAN v${p.version}: ${p.steps.map((s) => `${s.id}=[${s.candidates.map((c) => `${c.capability}/${c.operation}${c.arguments.anonymous === true ? "(anonymous)" : ""}`).join("|")}]`).join(" ")} rejected=${p.rejected.length}${p.version > 1 ? ` reason="${p.reason.slice(0, 100)}"` : ""} hash=${p.hash.slice(0, 12)}`);
  for (const s of t.steps) {
    for (const a of s.attempts) lines.push(`STEP ${s.step.id}: attempt ${a.seq} plan=v${a.planVersion} ${a.capability}/${a.operation} -> ${a.actionId ?? "no-receipt"} ${a.outcome}${a.deniedAt ? `@${a.deniedAt}` : ""} ok=${a.ok}${a.codes.length ? ` codes=${a.codes.join(",")}` : ""} => ${a.verdict}${a.verdict !== "VERIFIED" ? ` (${a.reason.slice(0, 120)})` : ""}`);
    lines.push(`STEP ${s.step.id}: status=${s.status} attempts=${s.attempts.length} retries=${s.retries} establishes=[${s.step.establishes.join(",")}]`);
  }
  lines.push(`STATES: ${t.history.map((h) => h.to).join(">")}`);
  lines.push(`GATEWAY: submitted=${r.gateway.submitted} executed=${r.gateway.executed} verified=${r.gateway.verified} denied=${Object.entries(r.gateway.denied).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(",") || "0"} transport_calls=${r.gateway.transport_calls ?? "n/a"} ungated_calls=${r.gateway.ungated_calls ?? "n/a"} checkpoints=${r.checkpoints.length} graph_entries=${r.graph.length}`);
  const o = t.outcome;
  lines.push(`OUTCOME: state=${t.state} outcome=${o?.status ?? "-"} met=[${o?.met.join(",") ?? ""}] unmet=[${o?.unmet.join(",") ?? ""}] unknown=[${o?.unknown.join(",") ?? ""}] violated=[${o?.violated.join(",") ?? ""}] blocked=[${o?.blocked.join(",") ?? ""}] replans=${t.replans} attempts=${t.attempts}${t.blockedReason ? ` reason="${t.blockedReason.replace(/[^\x20-\x7E]/g, "?").slice(0, 160)}"` : ""}`);
  return lines;
}
