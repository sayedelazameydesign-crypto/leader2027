/**
 * V5.3 — طبقة خدمة المنسّق HTTP (رفيعة: نقل فقط، بلا منطق تنسيق).
 *
 * كل دالة تأخذ `(repos, userId, input, now?)` وتعيد نتائج المنسّق كما هي.
 * المسارات تستدعيها بمقبض `getRepos()` طازج وساعة حقيقية لكل طلب.
 * المدفوع مرفوض fail-closed قبل لمس المنسّق (D3) — لا `call` عبر HTTP أبدًا.
 */
import type { Repos, TaskRecord } from "@/lib/repositories/interfaces";
import { PAID_OPERATION } from "@/lib/tasks/types";
import { ExecutionCoordinator } from "@/lib/workers/coordinator";
import { isReclaimable, latestLeaseOf } from "@/lib/workers/leases";
import { DEFAULT_HEARTBEAT_MARGIN_MS } from "@/lib/workers/types";
import type {
  BatchItem,
  BatchOutcome,
  ClaimOutcome,
  Denied,
  ExecuteOutcome,
  ExecuteStepInput,
  HeartbeatOutcome,
  ReleaseOutcome,
} from "@/lib/workers/types";

/** خطأ مدخلات عميل — المسار يترجمه `400` (لا 500 أبدًا). */
export class OrchestrateInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "OrchestrateInputError";
    this.field = field;
  }
}

export const PAID_NOT_WIRED: Denied = {
  status: "denied",
  code: "orchestrate.paid_not_wired",
  message: "التنفيذ المدفوع غير مربوط خادميًا بعد (P2) — رُفض بلا أي أثر (fail-closed)",
};

const INSTANCE_RE = /^[a-z0-9-]{1,32}$/;
export const MAX_BATCH_ITEMS = 25;

/**
 * هوية العامل مشتقة خادميًا من الجلسة (D2) — العميل يقدم اللاحقة فقط.
 * `u:{userId}:{instance ?? 0}` — الانتحال عبر المستخدمين مستحيل.
 */
export function workerIdFor(userId: string, instance?: string): string {
  if (!userId || typeof userId !== "string") {
    throw new OrchestrateInputError("user", "هوية المستخدم مطلوبة من الجلسة");
  }
  if (instance === undefined) return `u:${userId}:0`;
  if (typeof instance !== "string" || !INSTANCE_RE.test(instance)) {
    throw new OrchestrateInputError("instance", "لاحقة العامل: حروف صغيرة/أرقام/شرطة (1–32)");
  }
  return `u:${userId}:${instance}`;
}

/** نفس تعريف المنسّق حرفيًا (`needsGrant`) — أي خطوة تحتاج منحًا = مدفوعة المسار. */
function stepNeedsGrant(step: { operation: string; requiresApproval?: boolean }): boolean {
  return step.requiresApproval === true || step.operation === PAID_OPERATION;
}

function coordFor(repos: Repos, now: () => number): ExecutionCoordinator {
  return new ExecutionCoordinator(repos, { now });
}

export function claimTask(
  repos: Repos,
  userId: string,
  input: { taskId: string; instance?: string },
  now: () => number = Date.now,
): ClaimOutcome {
  return coordFor(repos, now).claim(input.taskId, workerIdFor(userId, input.instance));
}

export function heartbeatLease(
  repos: Repos,
  userId: string,
  input: { leaseId: string; instance?: string },
  now: () => number = Date.now,
): HeartbeatOutcome {
  return coordFor(repos, now).heartbeat(input.leaseId, workerIdFor(userId, input.instance));
}

export function releaseTask(
  repos: Repos,
  userId: string,
  input: { taskId: string; instance?: string },
  now: () => number = Date.now,
): ReleaseOutcome {
  return coordFor(repos, now).release(input.taskId, workerIdFor(userId, input.instance));
}

export type StepRequest = {
  taskId: string;
  stepId: string;
  instance?: string;
  verdict: "verified" | "failed";
  observation?: Record<string, unknown>;
  evidence?: unknown;
  artifact?: { type: string; ref: string };
};

export function executeStepFree(
  repos: Repos,
  userId: string,
  input: StepRequest,
  now: () => number = Date.now,
): ExecuteOutcome {
  const coord = coordFor(repos, now);
  const workerId = workerIdFor(userId, input.instance);
  const task = coord.engine.getTask(input.taskId);
  if (!task) {
    return { status: "denied", code: "task.missing", message: "مهمة غير موجودة — تُجاهَل تمامًا" };
  }
  const step = task.plan.find((s) => s.id === input.stepId);
  if (!step) {
    return { status: "denied", code: "task.step.missing", message: `خطوة غير مخطَّطة: "${input.stepId}"` };
  }
  if (stepNeedsGrant(step)) return { ...PAID_NOT_WIRED };
  const stepInput: ExecuteStepInput = {
    verdict: input.verdict,
    observation: input.observation,
    evidence: input.evidence,
    artifact: input.artifact,
  };
  return coord.executeStep(input.taskId, workerId, input.stepId, stepInput);
}

export type BatchRequest = {
  taskId: string;
  instance?: string;
  items: StepRequest[];
};

export function executeBatchFree(
  repos: Repos,
  userId: string,
  input: BatchRequest,
  now: () => number = Date.now,
): BatchOutcome {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new OrchestrateInputError("items", "الدفعة قائمة بنود غير فارغة (1–25)");
  }
  if (input.items.length > MAX_BATCH_ITEMS) {
    throw new OrchestrateInputError("items", `الدفعة بحد أقصى ${MAX_BATCH_ITEMS} بندًا`);
  }
  const coord = coordFor(repos, now);
  const workerId = workerIdFor(userId, input.instance);
  const task = coord.engine.getTask(input.taskId);
  if (!task) {
    // تفويض للمنسّق لينتج نتيجته القانونية (task.missing على البند الأول).
    return coord.executeBatch(
      input.taskId,
      workerId,
      input.items.map(toBatchItem),
    );
  }
  const byId = new Map(task.plan.map((s) => [s.id, s]));
  const paidIdx = input.items.findIndex((it) => {
    const step = byId.get(it.stepId);
    return step !== undefined && stepNeedsGrant(step);
  });
  const freePrefix = (paidIdx === -1 ? input.items : input.items.slice(0, paidIdx)).map(toBatchItem);
  const outcome =
    freePrefix.length > 0
      ? coord.executeBatch(input.taskId, workerId, freePrefix)
      : { completed: true, applied: 0, outcomes: [], task };
  if (outcome.completed && paidIdx !== -1) {
    // البادئة المجانية نُفِّذت (دائمة) ثم التوقف عند البند المدفوع (D6).
    const paid = input.items[paidIdx];
    return {
      completed: false,
      applied: outcome.applied,
      outcomes: [...outcome.outcomes, { stepId: paid.stepId, outcome: { ...PAID_NOT_WIRED } }],
      task: outcome.task,
    };
  }
  return outcome;
}

function toBatchItem(it: StepRequest): BatchItem {
  return {
    stepId: it.stepId,
    verdict: it.verdict,
    observation: it.observation,
    evidence: it.evidence,
    artifact: it.artifact,
  };
}

export type TaskStatusView = {
  task: {
    id: string;
    status: TaskRecord["status"];
    plan: Array<{ id: string; operation: string; status: string }>;
    checkpointHead: string;
    evidenceChainHead: string;
    updatedAt: string;
  };
  lease: null | {
    workerId: string;
    fencingToken: number;
    acquiredAt: string;
    expiresAt: string;
    releasedAt: string | null;
    reclaimable: boolean;
  };
  progress: { total: number; verified: number };
};

/** لقطة حالة للاستطلاع (polling) — `null` ⇒ مهمة مجهولة (404). */
export function getTaskStatus(
  repos: Repos,
  taskId: string,
  now: () => number = Date.now,
): TaskStatusView | null {
  const task = repos.tasks.getTask(taskId);
  if (!task) return null;
  const latest = latestLeaseOf(repos.tasks.listLeases(taskId));
  return {
    task: {
      id: task.id,
      status: task.status,
      plan: task.plan.map((s) => ({ id: s.id, operation: s.operation, status: s.status })),
      checkpointHead: task.checkpointHead,
      evidenceChainHead: task.evidenceChainHead,
      updatedAt: task.updatedAt,
    },
    lease:
      latest === null
        ? null
        : {
            workerId: latest.workerId,
            fencingToken: latest.fencingToken,
            acquiredAt: latest.acquiredAt,
            expiresAt: latest.expiresAt,
            releasedAt: latest.releasedAt,
            reclaimable: isReclaimable(latest, now(), DEFAULT_HEARTBEAT_MARGIN_MS),
          },
    progress: {
      total: task.plan.length,
      verified: task.plan.filter((s) => s.status === "verified").length,
    },
  };
}
