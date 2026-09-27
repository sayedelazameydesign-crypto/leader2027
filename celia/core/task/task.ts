/**
 * Celia · core/task · **المهمة** (GEN-2): الهدف، النية، العقد، الخطة (بإصداراتها)، الخطوات، الحالة، الحقائق، النتيجة.
 * كل انتقال حالة يمرّ بـ `transition()` الذي يستشير جدول الانتقالات ويكتب نقطة تفتيش — لا طريق آخر لتغيير الحالة.
 */
import type { DataClass, Facts, OutcomeContract, OutcomeVerdict } from "../../nexa/index.ts";
import type { ApprovalRequest } from "./approval.ts";
import type { Artifact } from "./artifact.ts";
import { makeCheckpoint, type CheckpointStore } from "./checkpoint.ts";
import type { PlanStep, StepRecord } from "./step.ts";
import { assertTransition, type TaskState } from "./task-state.ts";

export type Goal = {
  text: string;
  /** اختيار صريح لقالب فهم (اختياري) — وإلا يُطابَق النص. */
  templateId?: string;
  constraints?: { maxCostUsd?: number; dataClass?: DataClass; readOnly?: boolean };
  params?: Record<string, unknown>;
  /** عقد صريح من المستخدم يغلب عقد القالب. */
  contract?: OutcomeContract;
};

export type Intent = {
  id: string;
  goal: Goal;
  contract: OutcomeContract;
  /** من فهم الهدف: "template:<id>" في GEN-2 (لا نموذج لغوي). */
  understoodBy: string;
  strategyId: string;
  params: Record<string, unknown>;
  at: string;
};

export type Plan = {
  id: string;
  taskId: string;
  version: number;
  strategyId: string;
  steps: PlanStep[];
  /** مرشحون أُسقطوا وقت التخطيط/إعادته وسببه — الرفض دليل أيضًا. */
  rejected: { stepId: string; capability: string; operation: string; reason: string }[];
  reason: string;
  createdAt: string;
  hash: string;
};

export type StateChange = { seq: number; from: TaskState; to: TaskState; at: string; note: string };

/** تشغيل واحد للعملية (run أو resume) — للإثبات أن النقل الخام = تنفيذات البوابة في كل عملية على حدة. */
export type ProcessRun = { seq: number; mode: "run" | "resume"; startedAt: string; endedAt: string | null; executed: number; transportCalls: number | null; fromState: TaskState; toState: TaskState | null };

export type Task = {
  id: string;
  agentId: string;
  goal: Goal;
  intent: Intent | null;
  contract: OutcomeContract | null;
  plan: Plan | null;
  plans: Plan[];
  steps: StepRecord[];
  state: TaskState;
  history: StateChange[];
  replans: number;
  attempts: number;
  facts: Facts;
  outcome: OutcomeVerdict | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** GEN-3 */
  checkpointHead: string | null;
  evidenceChainHead: string;
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  /** طلب الموافقة المعلّق الذي أوقف المهمة في WAITING_APPROVAL. */
  pendingApprovalId: string | null;
  processes: ProcessRun[];
};

export function createTask(id: string, agentId: string, goal: Goal, at: string, checkpoints: CheckpointStore, evidenceHead: string): Task {
  const task: Task = { id, agentId, goal, intent: null, contract: null, plan: null, plans: [], steps: [], state: "CREATED", history: [], replans: 0, attempts: 0, facts: {}, outcome: null, blockedReason: null, createdAt: at, updatedAt: at, checkpointHead: null, evidenceChainHead: evidenceHead, artifacts: [], approvals: [], pendingApprovalId: null, processes: [] };
  checkpoints.append(makeCheckpoint(null, { taskId: id, at, from: null, state: "CREATED", planVersion: 0, stepId: null, note: "task created", evidenceHead }));
  task.checkpointHead = checkpoints.last()?.hash ?? null;
  return task;
}

export type TransitionContext = { at: string; note: string; evidenceHead: string; checkpoints: CheckpointStore; stepId?: string | null };

/** الانتقال الوحيد المسموح: يفحص الجدول، يسجّل التاريخ، ويكتب نقطة تفتيش مسلسلة. */
export function transition(task: Task, to: TaskState, ctx: TransitionContext): Task {
  assertTransition(task.state, to);
  const from = task.state;
  task.state = to;
  task.updatedAt = ctx.at;
  task.history.push({ seq: task.history.length + 1, from, to, at: ctx.at, note: ctx.note });
  ctx.checkpoints.append(makeCheckpoint(ctx.checkpoints.last(), { taskId: task.id, at: ctx.at, from, state: to, planVersion: task.plan?.version ?? 0, stepId: ctx.stepId ?? null, note: ctx.note, evidenceHead: ctx.evidenceHead }));
  task.checkpointHead = ctx.checkpoints.last()?.hash ?? null;
  task.evidenceChainHead = ctx.evidenceHead;
  return task;
}
