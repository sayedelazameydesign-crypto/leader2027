/**
 * GEN-3 — محرك المهام الدائم (Durable Task Engine).
 *
 * المبادئ الحاكمة:
 *  1. **الحالة تُشتق ولا تُسند** — لا توجد `setStatus` عامة؛ كل طريقة تشتق
 *     الحالة التالية من (الحالية + المدخلات) وتعبر الحارس البنيوي وحده.
 *  2. **كل انتقال = checkpoint** — مسلسل بالتجزئة (امتداد GEN-2) + رأس دليل.
 *  3. **fail-closed دائمًا** — الرفض/الانتهاء/العبث/عدم التطابق ⇒ توقف مصرّح
 *     (`BLOCKED`/`REPLANNING`/DENY) — أبدًا استمرار صامت.
 *  4. **متزامن** كـ`Repos` — بلا تنفيذ خارجي؛ «التنفيذ» تسجيل نتائج يحرسها المحرك.
 *  5. **مستقل عن النواة** (D2) — يستهلك `Repos` فقط؛ لا استيراد من kernel/cells.
 */
import type {
  PlannedStep,
  Repos,
  TaskApprovalRecord,
  TaskArtifactRecord,
  TaskCheckpoint,
  TaskGrantRecord,
  TaskRecord,
  TaskStatus,
} from "@/lib/repositories/interfaces";
import { rejectPoliticalFields } from "@/lib/validation/sensitive";
import { assertTransition } from "./machine";
import {
  CHECKPOINT_GENESIS,
  EVIDENCE_GENESIS,
  checkpointHash,
  evidenceHash,
  proposalHash,
} from "./hashing";
import {
  DEFAULT_APPROVAL_TTL_MS,
  PAID_OPERATION,
  SYSTEM_TASK_ACTOR,
  TaskEngineError,
  type ApprovalDecision,
  type StepInput,
  type TaskActor,
} from "./types";

export { PAID_OPERATION, TaskEngineError, SYSTEM_TASK_ACTOR };
export type { ApprovalDecision, StepInput, TaskActor };

export type EngineOptions = {
  /** حقن زمن — للاختبارات الحتمية (انتهاء الصلاحية). */
  now?: () => number;
  /** صلاحية طلب الموافقة — افتراضي 15 دقيقة. */
  approvalTtlMs?: number;
};

export type ApprovalRequestInput = {
  stepId: string;
  operation: string;
  costCap: number;
  /** المقترح القانوني — يُحفَظ تجزئته فقط (D6)، ويُعاد تقديمه عند الاستئناف (R2). */
  proposal: Record<string, unknown>;
};

export type DecideInput = {
  decision: ApprovalDecision;
  /** المُقرِّر — بشري حصرًا (D4/R§3). */
  by: TaskActor;
  /** بديل متاح؟ يقرّرها المنظّم — الافتراضي لا (fail-closed ⇒ BLOCKED). */
  alternativesAvailable?: boolean;
};

export type ResumeInput = {
  approvalId: string;
  operation: string;
  costCap: number;
  proposal: Record<string, unknown>;
  alternativesAvailable?: boolean;
};

export type StepOutcome = {
  verdict: "verified" | "failed";
  evidence?: unknown;
  /** يُقبَل مع `verified` فقط — مع `failed` ⇒ رفض صريح (artifact.unverified). */
  artifact?: { type: string; ref: string };
};

export type ConcludeInput = {
  /** حكم العقد: هل بقيت بدائل؟ — لا يختار المتصل الحالة مباشرة (R3). */
  alternativesAvailable: boolean;
};

export type ReplayResult = {
  valid: boolean;
  /** السياق المعاد بناؤه — دمج سياقات checkpoints بالترتيب (الأحدث يغلب). */
  context: Record<string, unknown>;
  /** الحالة المسجَّلة — يُستأنف إليها كما هي. */
  state: TaskStatus;
  checkpoints: number;
};

export class TaskEngine {
  private readonly repos: Repos;
  private readonly now: () => number;
  private readonly approvalTtlMs: number;

  constructor(repos: Repos, opts: EngineOptions = {}) {
    this.repos = repos;
    this.now = opts.now ?? (() => Date.now());
    this.approvalTtlMs = opts.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  /* ---------------------------------------------------------- قرّاء خالصون */

  getTask(id: string): TaskRecord | null {
    return this.repos.tasks.getTask(id);
  }

  listTasks(): TaskRecord[] {
    return this.repos.tasks.listTasks();
  }

  checkpoints(taskId: string): TaskCheckpoint[] {
    this.requireTask(taskId);
    return this.repos.tasks.listCheckpoints(taskId);
  }

  /** الموافقات — مع إسقاط المنتهية (hygiene فقط؛ تسوية المهمة صريحة عبر settle/decide/resume). */
  approvals(taskId: string): TaskApprovalRecord[] {
    this.requireTask(taskId);
    this.sweepApprovals(taskId, SYSTEM_TASK_ACTOR);
    return this.repos.tasks.listApprovals(taskId);
  }

  grants(taskId: string): TaskGrantRecord[] {
    this.requireTask(taskId);
    return this.repos.tasks.listGrants(taskId);
  }

  /** متاحة في أي حالة نهائية — غير مقيَّدة بـCOMPLETED (§8). */
  artifacts(taskId: string): TaskArtifactRecord[] {
    this.requireTask(taskId);
    return this.repos.tasks.listArtifacts(taskId);
  }

  /* ------------------------------------------------------------ دورة الحياة */

  /** إنشاء مهمة — `CREATED` + checkpoint التكوين (seq 0). */
  createTask(goal: string, actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const clean = goal?.trim() ?? "";
    if (!clean) {
      throw new TaskEngineError("task.goal", "هدف المهمة مطلوب — لا مهمة بلا هدف");
    }
    const at = this.stamp();
    const task = this.repos.tasks.createTask({
      goal: clean,
      status: "CREATED",
      plan: [],
      checkpointHead: "",
      evidenceChainHead: EVIDENCE_GENESIS,
      createdAt: at,
      updatedAt: at,
    });
    const headed = this.appendCheckpoint(task, "CREATED", null, { goal: clean }, at);
    this.audit(actor, "task.create", task.id, { state: "CREATED" });
    return headed;
  }

  /** فهم الهدف — `CREATED → UNDERSTANDING`. */
  understand(
    taskId: string,
    brief: Record<string, unknown> = {},
    actor: TaskActor = SYSTEM_TASK_ACTOR,
  ): TaskRecord {
    const task = this.requireTask(taskId);
    this.assertCleanPayload(brief);
    return this.transition(task, "UNDERSTANDING", actor, { brief: maskSecrets(brief) }, null);
  }

  /** التخطيط — `UNDERSTANDING → PLANNING` مع تخزين الخطة الدائمة. */
  plan(taskId: string, steps: StepInput[], actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const task = this.requireTask(taskId);
    const plan = toPlan(steps);
    return this.transition(task, "PLANNING", actor, { plan: planLite(plan) }, null, { plan });
  }

  /** الجاهزية — `PLANNING|REPLANNING → READY`. */
  markReady(taskId: string, actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const task = this.requireTask(taskId);
    if (!task.plan.length) {
      throw new TaskEngineError("task.plan.missing", "لا جاهزية بلا خطة مخزَّنة");
    }
    return this.transition(task, "READY", actor, { steps: task.plan.length }, null);
  }

  /* ------------------------------------------------- الموافقات المعلَّقة */

  /**
   * طلب موافقة — `PLANNING|READY ⇒ WAITING_APPROVAL` (R1) + تخزين `ApprovalRequest`.
   * المقترح الخام لا يُخزَّن — تجزئته فقط (D6).
   */
  requestApproval(
    taskId: string,
    input: ApprovalRequestInput,
    actor: TaskActor = SYSTEM_TASK_ACTOR,
  ): { task: TaskRecord; approval: TaskApprovalRecord } {
    const task = this.requireTask(taskId);
    assertTransition(task.status, "WAITING_APPROVAL");
    const step = task.plan.find((s) => s.id === input.stepId);
    if (!step) {
      throw new TaskEngineError("task.step.missing", `خطوة غير مخطَّطة: "${input.stepId}"`);
    }
    if (!input.operation?.trim()) {
      throw new TaskEngineError("task.operation", "اسم العملية مطلوب في طلب الموافقة");
    }
    assertCostCap(input.costCap);
    assertProposalObject(input.proposal);
    this.assertCleanPayload(input.proposal);

    this.sweepApprovals(taskId, actor);
    const at = this.stamp();
    const hash = proposalHash(input.proposal);
    const approval = this.repos.tasks.createApproval({
      taskId,
      stepId: input.stepId,
      proposalHash: hash,
      operation: input.operation,
      costCap: input.costCap,
      status: "pending",
      expiresAt: new Date(this.now() + this.approvalTtlMs).toISOString(),
      decidedBy: null,
      decidedAt: null,
      createdAt: at,
    });
    const moved = this.transition(
      task,
      "WAITING_APPROVAL",
      actor,
      { approvalId: approval.id, stepId: input.stepId, proposalHash: hash },
      input.stepId,
    );
    this.audit(actor, "task.approval.requested", taskId, {
      approval: approval.id,
      step: input.stepId,
      operation: input.operation,
    });
    return { task: moved, approval };
  }

  /**
   * قرار بشري — اعتماد ⇒ Grant أحادي (تبقى `WAITING_APPROVAL` حتى `resume`)،
   * رفض/انتهاء ⇒ fail-closed (`REPLANNING` ببديل وإلا `BLOCKED`).
   */
  decideApproval(
    approvalId: string,
    input: DecideInput,
  ): { task: TaskRecord; approval: TaskApprovalRecord; grant: TaskGrantRecord | null } {
    const actor = input.by;
    if (actor.kind !== "human") {
      this.audit(actor, "task.approval.denied_attempt", approvalId, { reason: "not_human" });
      throw new TaskEngineError(
        "approval.not_human",
        "قرار الموافقة بشري حصرًا — رُفضت المحاولة وسُجِّلت",
      );
    }
    const approval = this.repos.tasks.getApproval(approvalId);
    if (!approval) {
      throw new TaskEngineError("approval.missing", `طلب موافقة غير موجود: "${approvalId}"`);
    }
    const task = this.requireTask(approval.taskId);
    if (task.status !== "WAITING_APPROVAL") {
      throw new TaskEngineError(
        "task.state",
        `لا قرار خارج الانتظار — المهمة في ${task.status} (fail-closed)`,
      );
    }

    // انتهاء أثناء الانتظار ⇒ مسار المنتهي ولو كان القرار اعتمادًا (fail-closed).
    if (approval.status === "pending" && this.isExpired(approval)) {
      const expired = this.markExpired(approval, actor);
      const settled = this.failClosed(task, input.alternativesAvailable ?? false, actor, {
        reason: "expired",
        approvalId: approval.id,
      });
      return { task: settled, approval: expired, grant: null };
    }
    if (approval.status !== "pending") {
      throw new TaskEngineError(
        "approval.decided",
        `الطلب ${approval.id} محسوم (${approval.status}) — لا تراجع صامت`,
      );
    }

    const at = this.stamp();
    if (input.decision === "approved") {
      const decided = this.repos.tasks.updateApproval(approval.id, {
        status: "approved",
        decidedBy: actor.id,
        decidedAt: at,
      })!;
      const grant = this.repos.tasks.createGrant({
        approvalId: approval.id,
        taskId: task.id,
        stepId: approval.stepId,
        proposalHash: approval.proposalHash,
        operation: approval.operation,
        costCap: approval.costCap,
        createdAt: at,
        consumedAt: null,
      });
      // لقطة بلا انتقال — ما زالت WAITING_APPROVAL حتى resume (R2).
      const snap = this.appendCheckpoint(
        task,
        "WAITING_APPROVAL",
        approval.stepId,
        { approvalId: approval.id, grantId: grant.id, decision: "approved" },
        at,
      );
      this.audit(actor, "task.approval.granted", task.id, {
        approval: approval.id,
        grant: grant.id,
        step: approval.stepId,
      });
      return { task: snap, approval: decided, grant };
    }

    const decided = this.repos.tasks.updateApproval(approval.id, {
      status: "rejected",
      decidedBy: actor.id,
      decidedAt: at,
    })!;
    this.audit(actor, "task.approval.denied", task.id, {
      approval: approval.id,
      step: approval.stepId,
    });
    const settled = this.failClosed(task, input.alternativesAvailable ?? false, actor, {
      reason: "rejected",
      approvalId: approval.id,
    });
    return { task: settled, approval: decided, grant: null };
  }

  /**
   * استئناف بمنح — يعيد تحقق `proposalHash+operation+costCap` قبل `READY` (R2).
   * عدم تطابق/استهلاك مسبق ⇒ **DENY فوري** بلا انتقال.
   */
  resume(taskId: string, input: ResumeInput, actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const task = this.requireTask(taskId);
    if (task.status !== "WAITING_APPROVAL") {
      // R4: BLOCKED نهائي — وأي حالة أخرى ليست انتظارًا ⇒ رفض صريح.
      throw new TaskEngineError(
        "task.state",
        `لا استئناف من ${task.status} — الاستئناف من WAITING_APPROVAL فقط`,
      );
    }
    const approval = this.repos.tasks.getApproval(input.approvalId);
    if (!approval || approval.taskId !== taskId) {
      throw new TaskEngineError("approval.mismatch", "منح غريب عن المهمة — DENY فوري");
    }
    // منتهٍ أثناء الاستئناف ⇒ تسوية fail-closed فورًا (الافتراضي BLOCKED).
    if (approval.status === "pending" && this.isExpired(approval)) {
      this.markExpired(approval, actor);
      this.failClosed(task, input.alternativesAvailable ?? false, actor, {
        reason: "expired",
        approvalId: approval.id,
      });
      throw new TaskEngineError(
        "approval.expired",
        "انتهت صلاحية الموافقة أثناء الاستئناف — سُوِّيت المهمة fail-closed",
      );
    }
    if (approval.status === "pending") {
      throw new TaskEngineError("approval.pending", "الموافقة لم تُحسَم بعد — لا استئناف قبل القرار");
    }
    if (approval.status !== "approved") {
      this.failClosed(task, false, actor, { reason: approval.status, approvalId: approval.id });
      throw new TaskEngineError(
        "approval.denied",
        `الموافقة ${approval.status} — سُوِّيت المهمة fail-closed (BLOCKED)`,
      );
    }
    const grant = this.repos.tasks.getGrantByApproval(approval.id);
    if (!grant) {
      throw new TaskEngineError("grant.missing", "لا منح صادر لهذه الموافقة — DENY فوري");
    }
    if (grant.consumedAt) {
      throw new TaskEngineError(
        "grant.consumed",
        "المنح أحادي الاستهلاك وقد استُهلِك — DENY فوري (لا إعادة)",
      );
    }
    // R2: إعادة التحقق الكاملة قبل الرجوع READY.
    assertProposalObject(input.proposal);
    const presented = proposalHash(input.proposal);
    if (
      presented !== approval.proposalHash ||
      input.operation !== approval.operation ||
      input.costCap !== approval.costCap
    ) {
      throw new TaskEngineError(
        "approval.mismatch",
        "عدم تطابق proposalHash+operation+costCap — DENY فوري بلا انتقال",
      );
    }
    this.repos.tasks.updateGrant(grant.id, { consumedAt: this.stamp() });
    this.audit(actor, "task.grant.consumed", taskId, {
      approval: approval.id,
      grant: grant.id,
      step: approval.stepId,
    });
    return this.transition(
      task,
      "READY",
      actor,
      { approvalId: approval.id, grantId: grant.id },
      approval.stepId,
    );
  }

  /** تسوية المنتهية — hygiene صريحة بلا تخمين بدائل (الافتراضي fail-closed). */
  settleExpired(
    taskId: string,
    input: { alternativesAvailable?: boolean } = {},
    actor: TaskActor = SYSTEM_TASK_ACTOR,
  ): { task: TaskRecord; expired: number } {
    const task = this.requireTask(taskId);
    const expired = this.sweepApprovals(taskId, actor);
    const pendings = this.repos.tasks.listApprovals(taskId).filter((a) => a.status === "pending");
    if (task.status === "WAITING_APPROVAL" && expired > 0 && pendings.length === 0) {
      const settled = this.failClosed(task, input.alternativesAvailable ?? false, actor, {
        reason: "expired",
      });
      return { task: settled, expired };
    }
    return { task: this.requireTask(taskId), expired };
  }

  /* ------------------------------------------------------- حلقة التنفيذ */

  /**
   * بدء خطوة — `READY → EXECUTING` (الحلقة تعود لـREADY بعد كل حكم).
   * خطوة بمنح (`requiresApproval` أو `NEXA_A_PAID`) بلا منح مُستهلَك مطابق
   * ⇒ رفض `NEEDS_APPROVAL` — أبدًا استمرار صامت (R6).
   */
  beginExecution(taskId: string, stepId: string, actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const task = this.requireTask(taskId);
    const step = task.plan.find((s) => s.id === stepId);
    if (!step) {
      throw new TaskEngineError("task.step.missing", `خطوة غير مخطَّطة: "${stepId}"`);
    }
    if (step.status !== "pending") {
      throw new TaskEngineError(
        "task.step.state",
        `الخطوة "${stepId}" في ${step.status} — لا إعادة تشغيل (أعد التخطيط لبديل)`,
      );
    }
    if (needsGrant(step)) {
      const grant = this.repos.tasks.listGrants(taskId).find(
        (g) =>
          g.stepId === stepId &&
          g.consumedAt !== null &&
          g.operation === step.operation &&
          g.costCap >= step.costCap,
      );
      if (!grant) {
        throw new TaskEngineError(
          "task.needs_approval",
          `الخطوة "${stepId}" مدفوعة (${step.operation}) بلا منح — اطلب موافقة أولًا`,
        );
      }
    }
    const plan = task.plan.map((s) => (s.id === stepId ? { ...s, status: "running" as const } : s));
    return this.transition(task, "EXECUTING", actor, { stepId }, stepId, { plan });
  }

  /** رصد نتيجة الخطوة — `EXECUTING → OBSERVING`. */
  observeStep(
    taskId: string,
    stepId: string,
    observation: Record<string, unknown> = {},
    actor: TaskActor = SYSTEM_TASK_ACTOR,
  ): TaskRecord {
    const task = this.requireTask(taskId);
    const step = task.plan.find((s) => s.id === stepId);
    if (!step || step.status !== "running") {
      throw new TaskEngineError("task.step.state", `لا رصد لغير خطوة جارية: "${stepId}"`);
    }
    this.assertCleanPayload(observation);
    const plan = task.plan.map((s) => (s.id === stepId ? { ...s, status: "observed" as const } : s));
    return this.transition(
      task,
      "OBSERVING",
      actor,
      { stepId, observation: maskSecrets(observation) },
      stepId,
      { plan },
    );
  }

  /**
   * حكم الخطوة — `OBSERVING → READY` (بقيت خطوات: الحلقة) أو `→ VERIFYING` (اكتملت).
   * `verified` تمدّد سلسلة الدليل وتُرفَق بـartifact اختياري؛ `failed` تُدوَّن للحكم النهائي.
   */
  verifyStep(
    taskId: string,
    stepId: string,
    outcome: StepOutcome,
    actor: TaskActor = SYSTEM_TASK_ACTOR,
  ): TaskRecord {
    const task = this.requireTask(taskId);
    const step = task.plan.find((s) => s.id === stepId);
    if (!step || step.status !== "observed") {
      throw new TaskEngineError("task.step.state", `لا حكم على غير خطوة مرصودة: "${stepId}"`);
    }
    if (outcome.verdict !== "verified" && outcome.verdict !== "failed") {
      throw new TaskEngineError("task.verdict", "الحكم verified أو failed فقط");
    }
    if (outcome.verdict === "failed" && outcome.artifact) {
      throw new TaskEngineError(
        "artifact.unverified",
        "لا artifact من خطوة فاشلة — من VERIFIED فقط (fail-closed قبل أي أثر)",
      );
    }
    if (outcome.evidence && typeof outcome.evidence === "object" && !Array.isArray(outcome.evidence)) {
      this.assertCleanPayload(outcome.evidence as Record<string, unknown>);
    }

    let evidenceChainHead = task.evidenceChainHead;
    let evidenceHashValue: string | null = null;
    if (outcome.verdict === "verified") {
      evidenceHashValue = evidenceHash(evidenceChainHead, stepId, outcome.evidence ?? {});
      evidenceChainHead = evidenceHashValue;
      if (outcome.artifact) {
        if (!outcome.artifact.type?.trim() || !outcome.artifact.ref?.trim()) {
          throw new TaskEngineError("artifact.invalid", "الـartifact يتطلب type وref غير فارغين");
        }
        const at = this.stamp();
        this.repos.tasks.createArtifact({
          taskId,
          stepId,
          type: outcome.artifact.type,
          ref: outcome.artifact.ref,
          evidenceHash: evidenceHashValue,
          createdAt: at,
        });
        this.audit(actor, "task.artifact.recorded", taskId, {
          step: stepId,
          type: outcome.artifact.type,
        });
      }
    }
    const plan = task.plan.map((s) =>
      s.id === stepId ? { ...s, status: outcome.verdict as "verified" | "failed" } : s,
    );
    const unjudged = plan.some(
      (s) => s.status === "pending" || s.status === "running" || s.status === "observed",
    );
    return this.transition(
      task,
      unjudged ? "READY" : "VERIFYING",
      actor,
      { stepId, verdict: outcome.verdict, ...(evidenceHashValue ? { evidenceHash: evidenceHashValue } : {}) },
      stepId,
      { plan, evidenceChainHead },
    );
  }

  /**
   * حكم العقد — `VERIFYING ⇒ {COMPLETED | PARTIAL | RECOVERING}` (R3).
   * المتصل لا يختار الحالة — تُشتق من أحكام الخطوات + بقاء البدائل.
   */
  conclude(taskId: string, input: ConcludeInput, actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const task = this.requireTask(taskId);
    if (task.status !== "VERIFYING") {
      // R3: لا حكم خارج VERIFYING — يُرمى قبل أي أثر.
      throw new TaskEngineError(
        "task.state",
        `لا حكم من ${task.status} — الحكم من VERIFYING فقط (حكم العقد لا الوكيل)`,
      );
    }
    const incomplete = task.plan.filter(
      (s) => s.status !== "verified" && s.status !== "failed",
    );
    if (incomplete.length) {
      throw new TaskEngineError(
        "task.plan.incomplete",
        `لا حكم قبل حسم كل الخطوات — معلَّقة: [${incomplete.map((s) => s.id).join(", ")}]`,
      );
    }
    const failed = task.plan.filter((s) => s.status === "failed").length;
    const verified = task.plan.length - failed;
    const to: TaskStatus =
      failed === 0 ? "COMPLETED" : input.alternativesAvailable ? "RECOVERING" : "PARTIAL";
    return this.transition(task, to, actor, { outcome: to, verified, failed }, null);
  }

  /**
   * إعادة التخطيط — `RECOVERING|WAITING_APPROVAL|REPLANNING → REPLANNING`.
   * من الانتظار: تُسقَط المعلَّقة (هجر صريح لمسار الموافقة — لا أيتام).
   */
  replan(taskId: string, steps: StepInput[], actor: TaskActor = SYSTEM_TASK_ACTOR): TaskRecord {
    const task = this.requireTask(taskId);
    assertTransition(task.status === "RECOVERING" || task.status === "WAITING_APPROVAL" || task.status === "REPLANNING" ? task.status : "CREATED", "REPLANNING");
    const plan = toPlan(steps);
    if (task.status === "WAITING_APPROVAL") {
      this.expireAllPending(taskId, actor, "replan");
    }
    return this.transition(task, "REPLANNING", actor, { plan: planLite(plan) }, null, { plan });
  }

  /* ------------------------------------------- السلامة والاستئناف (GEN2_REPLAY) */

  /**
   * تحقق السلسلة — إعادة حساب كل تجزئة + الوصلات + الرأس.
   * أي عبث (تعديل/حذف/إعادة ترتيب) ⇒ `false`.
   */
  verifyChain(taskId: string): boolean {
    const task = this.repos.tasks.getTask(taskId);
    if (!task) return false;
    const cps = this.repos.tasks.listCheckpoints(taskId);
    if (!cps.length) return false;
    let prev = CHECKPOINT_GENESIS;
    for (let i = 0; i < cps.length; i += 1) {
      const cp = cps[i];
      if (cp.seq !== i || cp.prevHash !== prev) return false;
      const recomputed = checkpointHash({
        prevHash: cp.prevHash,
        taskId: cp.taskId,
        seq: cp.seq,
        state: cp.state,
        stepId: cp.stepId,
        context: cp.context,
        evidenceHead: cp.evidenceHead,
        at: cp.at,
      });
      if (recomputed !== cp.hash) return false;
      prev = cp.hash;
    }
    return task.checkpointHead === prev;
  }

  /** إعادة التشغيل (GEN2_REPLAY): تحقق → دمج السياقات → الحالة المسجَّلة. */
  replay(taskId: string): ReplayResult {
    const task = this.requireTask(taskId);
    const cps = this.repos.tasks.listCheckpoints(taskId);
    const context: Record<string, unknown> = {};
    for (const cp of cps) Object.assign(context, cp.context);
    return { valid: this.verifyChain(taskId), context, state: task.status, checkpoints: cps.length };
  }

  /**
   * استئناف بعد قتل — تحميل آخر checkpoint → تحقق السلسلة → إعادة بناء السياق
   * → الرجوع للحالة المسجَّلة. سلسلة مكسورة ⇒ رفض (fail-closed).
   * قراءة خالصة: لا انتقال ولا checkpoint (الرأس يقارَن مع التشغيل المتواصل).
   */
  resumeAfterKill(
    taskId: string,
    actor: TaskActor = SYSTEM_TASK_ACTOR,
  ): { task: TaskRecord; context: Record<string, unknown>; checkpoints: number } {
    const task = this.requireTask(taskId);
    const rep = this.replay(taskId);
    if (!rep.valid) {
      this.audit(actor, "task.resume.rejected", taskId, { reason: "integrity" });
      throw new TaskEngineError(
        "task.integrity",
        "سلسلة checkpoints مكسورة — الاستئناف مرفوض (fail-closed)",
      );
    }
    this.audit(actor, "task.resumed", taskId, { state: task.status, checkpoints: rep.checkpoints });
    return { task, context: rep.context, checkpoints: rep.checkpoints };
  }

  /* ---------------------------------------------------------------- داخلي */

  private requireTask(taskId: string): TaskRecord {
    const task = this.repos.tasks.getTask(taskId);
    if (!task) {
      throw new TaskEngineError("task.missing", `مهمة غير موجودة: "${taskId}"`);
    }
    return task;
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private audit(
    actor: TaskActor,
    action: string,
    entityId: string,
    meta: Record<string, string | number> = {},
  ): void {
    this.repos.audit.append({
      actor_id: actor.id,
      actor_role: actor.role ?? "VIEWER",
      action,
      entity_type: "task",
      entity_id: entityId,
      at: this.stamp(),
      meta,
    });
  }

  /** الانتقال الوحيد — حارس بنيوي + checkpoint + تدقيق (ذرّي منطقيًا). */
  private transition(
    task: TaskRecord,
    to: TaskStatus,
    actor: TaskActor,
    context: Record<string, unknown>,
    stepId: string | null,
    patch: Partial<TaskRecord> = {},
  ): TaskRecord {
    assertTransition(task.status, to);
    const at = this.stamp();
    const updated = this.repos.tasks.updateTask(task.id, {
      ...patch,
      status: to,
      updatedAt: at,
    })!;
    const headed = this.appendCheckpoint(updated, to, stepId, context, at);
    this.audit(actor, "task.transition", task.id, { from: task.status, to });
    return headed;
  }

  /** إلحاق checkpoint وتحديث الرأس — يُستعمل للانتقالات واللقطات. */
  private appendCheckpoint(
    task: TaskRecord,
    state: TaskStatus,
    stepId: string | null,
    context: Record<string, unknown>,
    at: string,
  ): TaskRecord {
    const seq = this.repos.tasks.listCheckpoints(task.id).length;
    const prevHash = task.checkpointHead || CHECKPOINT_GENESIS;
    const hash = checkpointHash({
      prevHash,
      taskId: task.id,
      seq,
      state,
      stepId,
      context,
      evidenceHead: task.evidenceChainHead,
      at,
    });
    this.repos.tasks.appendCheckpoint({
      taskId: task.id,
      seq,
      state,
      stepId,
      context,
      prevHash,
      hash,
      evidenceHead: task.evidenceChainHead,
      at,
    });
    return this.repos.tasks.updateTask(task.id, { checkpointHead: hash, updatedAt: at })!;
  }

  /** الإغلاق الآمن — بديل ⇒ REPLANNING وإلا BLOCKED (نهائي بلا retry). */
  private failClosed(
    task: TaskRecord,
    alternativesAvailable: boolean,
    actor: TaskActor,
    context: Record<string, unknown>,
  ): TaskRecord {
    this.expireAllPending(task.id, actor, "fail-closed");
    return this.transition(
      this.requireTask(task.id),
      alternativesAvailable ? "REPLANNING" : "BLOCKED",
      actor,
      context,
      null,
    );
  }

  private isExpired(approval: TaskApprovalRecord): boolean {
    return Date.parse(approval.expiresAt) <= this.now();
  }

  private markExpired(approval: TaskApprovalRecord, actor: TaskActor): TaskApprovalRecord {
    const marked = this.repos.tasks.updateApproval(approval.id, {
      status: "expired",
      decidedAt: this.stamp(),
    })!;
    this.audit(actor, "task.approval.expired", approval.taskId, {
      approval: approval.id,
      step: approval.stepId,
    });
    return marked;
  }

  /** إسقاط المنتهية المعلَّقة — يُرجع عدد ما أُسقِط (hygiene بلا انتقالات). */
  private sweepApprovals(taskId: string, actor: TaskActor): number {
    let expired = 0;
    for (const approval of this.repos.tasks.listApprovals(taskId)) {
      if (approval.status === "pending" && this.isExpired(approval)) {
        this.markExpired(approval, actor);
        expired += 1;
      }
    }
    return expired;
  }

  /** إسقاط كل المعلَّقة — عند هجر مسار الانتظار (لا موافقات يتيمة). */
  private expireAllPending(taskId: string, actor: TaskActor, reason: string): void {
    for (const approval of this.repos.tasks.listApprovals(taskId)) {
      if (approval.status === "pending") {
        this.repos.tasks.updateApproval(approval.id, {
          status: "expired",
          decidedAt: this.stamp(),
        });
        this.audit(actor, "task.approval.expired", taskId, {
          approval: approval.id,
          step: approval.stepId,
          reason,
        });
      }
    }
  }

  /** §5 — أي حمولة تحمل حقولًا سياسية محظورة تُرفض صراحةً. */
  private assertCleanPayload(payload: Record<string, unknown>): void {
    const errors = rejectPoliticalFields(payload);
    const fields = Object.keys(errors);
    if (fields.length) {
      throw new TaskEngineError(
        "task.forbidden",
        `حمولة مرفوضة بموجب §5: [${fields.join(", ")}] — لا تفضيلات أو تقييمات سياسية`,
      );
    }
  }
}

/* ------------------------------------------------------------------ أدوات */

/** الخطوة تتطلب منحًا؟ صريح (`requiresApproval`) أو مدفوعة قانونيًا (`NEXA_A_PAID`). */
function needsGrant(step: PlannedStep): boolean {
  return step.requiresApproval || step.operation === PAID_OPERATION;
}

function toPlan(steps: StepInput[]): PlannedStep[] {
  if (!Array.isArray(steps) || !steps.length) {
    throw new TaskEngineError("task.plan.empty", "الخطة فارغة — خطوة واحدة على الأقل");
  }
  const seen = new Set<string>();
  return steps.map((s, i) => {
    const id = s?.id?.trim() ?? "";
    if (!id) throw new TaskEngineError("task.plan.step", `الخطوة #${i} بلا معرّف`);
    if (seen.has(id)) throw new TaskEngineError("task.plan.step", `معرّف خطوة مكرر: "${id}"`);
    seen.add(id);
    if (!s.operation?.trim()) {
      throw new TaskEngineError("task.plan.step", `الخطوة "${id}" بلا عملية`);
    }
    assertCostCap(s.costCap);
    return {
      id,
      operation: s.operation,
      costCap: s.costCap,
      requiresApproval: s.requiresApproval ?? false,
      status: "pending",
    };
  });
}

function planLite(plan: PlannedStep[]): Array<{ id: string; operation: string }> {
  return plan.map((s) => ({ id: s.id, operation: s.operation }));
}

function assertCostCap(costCap: unknown): void {
  if (typeof costCap !== "number" || !Number.isFinite(costCap) || costCap < 0) {
    throw new TaskEngineError("task.cost_cap", "سقف التكلفة رقم محدود غير سالب");
  }
}

function assertProposalObject(proposal: unknown): asserts proposal is Record<string, unknown> {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new TaskEngineError("task.proposal", "المقترح كائن قانوني (hashable object)");
  }
}

/**
 * حجب المفاتيح الحساسة قبل التخزين في السياق — نفس روح `sanitize` في النواة
 * (محلي هنا: D2 تمنع استيراد النواة).
 */
function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /password|secret|token/i.test(key) ? "***" : maskSecrets(entry);
    }
    return out;
  }
  return value;
}
