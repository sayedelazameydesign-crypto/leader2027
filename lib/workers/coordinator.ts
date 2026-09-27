/**
 * GEN-4 — منسّق التنفيذ الموزّع (ExecutionCoordinator).
 *
 * طبقة ملكية فوق محرك GEN-3 — لا تغيّر سطرًا فيه (العقد §12):
 *  - الـclaim/القلب/التسليم: صفوف `Lease` في `Store` (المصدر الوحيد، D1).
 *  - التنفيذ: فحص lease (R7) + تحقق سلسلة (R9) + إعادة تحقق NEXA (R10)
 *    + سجل منفَّذ (exactly-once) — ثم تفويض المحرك للانتقالات التجارية.
 *  - كل الطرق كلّية: `{status: …}` دائمًا — الرفض قيمة لا استثناء (D3).
 */
import type {
  PlannedStep,
  Repos,
  TaskAttemptRecord,
  TaskRecord,
} from "@/lib/repositories/interfaces";
import { TaskEngine } from "@/lib/tasks/engine";
import { isTerminal } from "@/lib/tasks/machine";
import { PAID_OPERATION, TaskEngineError, type TaskActor } from "@/lib/tasks/types";
import { rejectPoliticalFields } from "@/lib/validation/sensitive";
import {
  attemptToken,
  isReclaimable,
  isHolding,
  latestLeaseOf,
  resultHash,
} from "./leases";
import {
  DEFAULT_HEARTBEAT_MARGIN_MS,
  DEFAULT_LEASE_TTL_MS,
  WorkerError,
  type BatchItem,
  type BatchOutcome,
  type ClaimOutcome,
  type Denied,
  type ExecuteOutcome,
  type ExecuteStepInput,
  type HeartbeatOutcome,
  type ReleaseOutcome,
} from "./types";

export {
  DEFAULT_HEARTBEAT_MARGIN_MS,
  DEFAULT_LEASE_TTL_MS,
  WorkerError,
  PAID_OPERATION,
};
export type {
  BatchItem,
  BatchOutcome,
  ClaimOutcome,
  Denied,
  ExecuteOutcome,
  ExecuteStepInput,
  HeartbeatOutcome,
  ReleaseOutcome,
};

export type CoordinatorOptions = {
  /** حقن زمن مشترك (المنسّق والمحرك) — للاختبارات الحتمية. */
  now?: () => number;
  leaseTtlMs?: number;
  heartbeatMarginMs?: number;
  /** يُمرَّر للمحرك المملوك (صلاحية طلبات الموافقة). */
  approvalTtlMs?: number;
};

function denied(code: string, message: string): Denied {
  return { status: "denied", code, message };
}

function workerActor(workerId: string): TaskActor {
  return { id: workerId, kind: "agent" };
}

function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkerError("worker.id", `معرّف ${name} مطلوب غير فارغ`);
  }
}

export class ExecutionCoordinator {
  private readonly repos: Repos;
  private readonly now: () => number;
  private readonly leaseTtlMs: number;
  private readonly marginMs: number;

  /** المحرك المملوك — للتدفق التجاري (تخطيط/حكم…) بنفس الساعة. */
  readonly engine: TaskEngine;

  constructor(repos: Repos, opts: CoordinatorOptions = {}) {
    this.repos = repos;
    this.now = opts.now ?? (() => Date.now());
    this.leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.marginMs = opts.heartbeatMarginMs ?? DEFAULT_HEARTBEAT_MARGIN_MS;
    this.engine = new TaskEngine(repos, {
      now: this.now,
      ...(opts.approvalTtlMs !== undefined ? { approvalTtlMs: opts.approvalTtlMs } : {}),
    });
  }

  /* ---------------------------------------------------------- الملكية */

  /**
   * المطالبة بمهمة — واحد يفوز والبقية denied بهدوء (§8/1).
   * الاسترداد (منتهٍ/في الهامش) يتحقق من السلسلة أولًا (R9) — مكسورة ⇒ deny.
   */
  claim(taskId: string, workerId: string): ClaimOutcome {
    assertId(taskId, "المهمة");
    assertId(workerId, "الـworker");
    const task = this.repos.tasks.getTask(taskId);
    if (!task) return denied("task.missing", "مهمة غير موجودة — تُجاهَل تمامًا");
    if (isTerminal(task.status)) {
      return denied("task.terminal", `المهمة في ${task.status} — لا ملكية بلا عمل`);
    }
    if (!this.engine.verifyChain(taskId)) {
      this.audit(workerId, "lease.denied", taskId, { reason: "integrity" });
      return denied("task.integrity", "سلسلة التجزئة مكسورة — لا استئناف أعمى (R9)");
    }
    const now = this.now();
    const latest = latestLeaseOf(this.repos.tasks.listLeases(taskId));
    if (latest && !isReclaimable(latest, now, this.marginMs)) {
      this.audit(workerId, "lease.denied", taskId, { lease: latest.id, holder: latest.workerId });
      return denied(
        "lease.held",
        `المهمة مملوكة لـ"${latest.workerId}" حتى ${latest.expiresAt} — تُجاهَل بهدوء (لا تنفيذ متفائل)`,
      );
    }
    const reclaimed = latest !== null && latest.releasedAt === null;
    const at = this.stamp();
    const lease = this.repos.tasks.createLease({
      taskId,
      workerId,
      fencingToken: (latest?.fencingToken ?? 0) + 1,
      acquiredAt: at,
      expiresAt: new Date(now + this.leaseTtlMs).toISOString(),
      lastHeartbeatAt: at,
      releasedAt: null,
    });
    this.audit(workerId, reclaimed ? "lease.reclaimed" : "lease.claimed", taskId, {
      lease: lease.id,
      fencing: lease.fencingToken,
    });
    return { status: "claimed", lease, reclaimed };
  }

  /**
   * نبضة التجديد — تمدّد `expiresAt` وتُسجَّل (R8).
   * مستبدَلة/منتهية/لغير المالك ⇒ denied — والـstale يتوقف (fencing).
   */
  heartbeat(leaseId: string, workerId: string): HeartbeatOutcome {
    assertId(leaseId, "الـlease");
    assertId(workerId, "الـworker");
    const lease = this.repos.tasks.getLease(leaseId);
    if (!lease) return denied("lease.missing", "lease غير موجود");
    if (lease.workerId !== workerId) {
      return denied("lease.not_owner", "النبضة من المالك فقط");
    }
    const latest = latestLeaseOf(this.repos.tasks.listLeases(lease.taskId));
    if (!latest || latest.id !== lease.id) {
      return denied("lease.superseded", "حلّ محلك lease أحدث — توقف فورًا (fencing)");
    }
    if (lease.releasedAt !== null) return denied("lease.released", "lease مُسلَّم — لا تجديد");
    if (this.now() >= Date.parse(lease.expiresAt)) {
      return denied("lease.expired", "فات الأوان — الـlease انتهى وقابل للاسترداد");
    }
    const at = this.stamp();
    const updated = this.repos.tasks.updateLease(lease.id, {
      expiresAt: new Date(this.now() + this.leaseTtlMs).toISOString(),
      lastHeartbeatAt: at,
    })!;
    this.repos.tasks.recordHeartbeat({ leaseId: lease.id, taskId: lease.taskId, workerId, at });
    return { status: "ok", lease: updated };
  }

  /** التسليم الطوعي — من المالك الحالي فقط. */
  release(taskId: string, workerId: string): ReleaseOutcome {
    assertId(taskId, "المهمة");
    assertId(workerId, "الـworker");
    const latest = latestLeaseOf(this.repos.tasks.listLeases(taskId));
    if (!latest || latest.workerId !== workerId) {
      return denied("lease.not_owner", "التسليم من المالك الحالي فقط");
    }
    if (latest.releasedAt !== null) return denied("lease.released", "مُسلَّم مسبقًا");
    const updated = this.repos.tasks.updateLease(latest.id, { releasedAt: this.stamp() })!;
    this.audit(workerId, "lease.released", taskId, { lease: latest.id });
    return { status: "released", lease: updated };
  }

  /* ---------------------------------------------------------- التنفيذ */

  /**
   * تنفيذ خطوة تحت الملكية — البوابة الوحيدة للـworkers نحو المحرك:
   * lease (R7) ⇒ سلسلة سليمة (R9) ⇒ grant+cap الآن (R10) ⇒ سجل منفَّذ
   * (exactly-once) ⇒ تفويض المحرك. أي فحص يسقط ⇒ denied بلا أي أثر.
   */
  executeStep(
    taskId: string,
    workerId: string,
    stepId: string,
    input: ExecuteStepInput,
  ): ExecuteOutcome {
    assertId(taskId, "المهمة");
    assertId(workerId, "الـworker");
    assertId(stepId, "الخطوة");
    if (!input || typeof input !== "object") {
      throw new WorkerError("worker.input", "مدخلات التنفيذ كائن مطلوب");
    }
    if (input.verdict !== "verified" && input.verdict !== "failed") {
      throw new WorkerError("worker.verdict", "الحكم verified أو failed صراحةً (لا نجاح صامت)");
    }
    const task = this.repos.tasks.getTask(taskId);
    if (!task) return denied("task.missing", "مهمة غير موجودة — تُجاهَل تمامًا");
    const latest = latestLeaseOf(this.repos.tasks.listLeases(taskId));
    const lease = latest && isHolding(latest, latest, workerId, this.now()) ? latest : null;
    if (!lease) {
      return denied("lease.not_held", "لا تنفيذ بلا lease نشط مملوك (R7) — denied مش استثناء");
    }
    if (!this.engine.verifyChain(taskId)) {
      return denied("task.integrity", "السلسلة مكسورة mid-flight (fork محتمل) — توقف (fail-closed)");
    }
    const step = task.plan.find((s) => s.id === stepId);
    if (!step) return denied("task.step.missing", `خطوة غير مخطَّطة: "${stepId}"`);
    if (step.status === "verified") return { status: "already-verified", task };
    if (step.status === "failed") {
      return denied("task.step.state", "لا إعادة لخطوة فاشلة — أعد التخطيط لبديل");
    }

    // R10: إعادة التحقق عند التنفيذ الفعلي — لا قرار قديم من وقت الـclaim.
    let proposalHashValue: string | null = null;
    let prior: TaskAttemptRecord | null = null;
    if (needsGrant(step)) {
      const grant = this.repos.tasks
        .listGrants(taskId)
        .find(
          (g) =>
            g.stepId === stepId &&
            g.consumedAt !== null &&
            g.operation === step.operation &&
            g.costCap >= step.costCap,
        );
      if (!grant) {
        return denied(
          "grant.invalid",
          "لا منح صالح عند التنفيذ الفعلي (R10) — رُفض بلا أي نداء",
        );
      }
      proposalHashValue = grant.proposalHash;
      prior = this.repos.tasks.findAttempt(taskId, stepId, grant.proposalHash);
      if (!prior && !input.call) {
        return denied("step.call.missing", "الفعل المدفوع يتطلب منفِّذ call — رُفض بلا تنفيذ");
      }
    }

    try {
      // منفَّذ سابقًا في أي حقبة ⇒ إكمال idempotent بلا نداء جديد.
      if (prior) {
        return this.finishStep(task, workerId, lease.fencingToken, step, input, {
          result: prior.result,
          attempt: prior,
          duplicate: true,
        });
      }
      let attempt: TaskAttemptRecord | null = null;
      let result: unknown = null;
      if (proposalHashValue !== null) {
        // النافذة الحرجة الوحيدة: النداء ثم التسجيل (حد الطبقة §9/2).
        result = input.call!();
        const masked = maskSecrets(result);
        if (masked && typeof masked === "object" && !Array.isArray(masked)) {
          if (Object.keys(rejectPoliticalFields(masked as Record<string, unknown>)).length) {
            return denied("task.forbidden", "نتيجة النداء تحمل حقول §5 — أُسقِطت بلا تسجيل (fail-closed)");
          }
        }
        attempt = this.repos.tasks.recordAttempt({
          taskId,
          stepId,
          proposalHash: proposalHashValue,
          attemptToken: attemptToken(proposalHashValue, lease.fencingToken),
          fencingToken: lease.fencingToken,
          status: "executed",
          evidenceHash: resultHash(masked),
          result: masked,
          recordedAt: this.stamp(),
        });
      }
      return this.finishStep(task, workerId, lease.fencingToken, step, input, {
        result,
        attempt,
        duplicate: false,
      });
    } catch (err) {
      if (err instanceof TaskEngineError) {
        return denied(err.code, err.message);
      }
      if (err instanceof WorkerError) throw err;
      return denied(
        "step.call.failed",
        `النداء الخارجي فشل (${err instanceof Error ? err.message : String(err)}) — الخطوة باقية قابلة للاستئناف`,
      );
    }
  }

  /**
   * دفعة تنفيذية (D6): تطبيق مرتّب عبر نفس المحرك والسلسلة نفسها —
   * تتوقف عند أول رفض/فشل. البادئة الدائمة + السلسلة هما الضمان (§7).
   */
  executeBatch(taskId: string, workerId: string, items: BatchItem[]): BatchOutcome {
    assertId(taskId, "المهمة");
    assertId(workerId, "الـworker");
    if (!Array.isArray(items) || !items.length) {
      throw new WorkerError("worker.batch", "الدفعة قائمة بنود غير فارغة");
    }
    const outcomes: Array<{ stepId: string; outcome: ExecuteOutcome }> = [];
    let applied = 0;
    let completed = true;
    for (const item of items) {
      if (!item || typeof item.stepId !== "string") {
        throw new WorkerError("worker.batch", "كل بند يحمل stepId");
      }
      const outcome = this.executeStep(taskId, workerId, item.stepId, item);
      outcomes.push({ stepId: item.stepId, outcome });
      if (outcome.status === "ok") {
        applied += 1;
        continue;
      }
      if (outcome.status === "already-verified" || outcome.status === "skipped-duplicate") {
        continue; // تقدُّم idempotent — يُتابَع للبند التالي
      }
      completed = false; // denied ⇒ توقف فوري (لا تخطٍّ)
      break;
    }
    return { completed, applied, outcomes, task: this.repos.tasks.getTask(taskId) };
  }

  /* ------------------------------------------------------------ داخلي */

  /**
   * إتمام الخطوة من نقطتها الدائمة: pending ⇒ begin · running ⇒ observe ·
   * observed ⇒ verify. يُستدعى بعد فحوص الملكية والمنح والسجل.
   */
  private finishStep(
    task: TaskRecord,
    workerId: string,
    fencingToken: number,
    step: PlannedStep,
    input: ExecuteStepInput,
    paid: { result: unknown; attempt: TaskAttemptRecord | null; duplicate: boolean },
  ): ExecuteOutcome {
    const actor = workerActor(workerId);
    const taskId = task.id;
    const stepId = step.id;
    const paidStep = needsGrant(step);

    if (step.status === "pending") {
      this.engine.beginExecution(taskId, stepId, actor);
    }
    const current = this.repos.tasks.getTask(taskId)!.plan.find((s) => s.id === stepId)!;
    if (current.status === "running") {
      const observation = resolveObservation(input.observation, paid.result);
      this.engine.observeStep(taskId, stepId, observation, actor);
    }
    // observed (طازجة أو مستردة mid-step): الدليل = الصريح ⇒ المرصود الدائم ⇒ نتيجة السجل.
    const evidence =
      input.evidence ?? lastObservation(this.repos, taskId, stepId) ?? paid.result ?? {};
    const done = this.engine.verifyStep(
      taskId,
      stepId,
      {
        verdict: input.verdict,
        evidence,
        ...(input.artifact ? { artifact: input.artifact } : {}),
      },
      actor,
    );
    if (paidStep && paid.duplicate && paid.attempt) {
      this.audit(workerId, "step.skipped", taskId, { step: stepId, reason: "duplicate" });
      return { status: "skipped-duplicate", task: done, attempt: paid.attempt };
    }
    this.audit(workerId, "step.executed", taskId, {
      step: stepId,
      fencing: fencingToken,
      verdict: input.verdict,
    });
    return { status: "ok", task: done, attempt: paid.attempt };
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private audit(workerId: string, action: string, taskId: string, meta: Record<string, string | number>): void {
    this.repos.audit.append({
      actor_id: workerId,
      actor_role: "VIEWER",
      action,
      entity_type: "task",
      entity_id: taskId,
      at: this.stamp(),
      meta,
    });
  }
}

/* ------------------------------------------------------------------ أدوات */

function needsGrant(step: PlannedStep): boolean {
  return step.requiresApproval || step.operation === PAID_OPERATION;
}

/** الرصد: الصريح ⇒ نتيجة النداء (كائنًا) ⇒ فارغ. */
function resolveObservation(
  explicit: Record<string, unknown> | undefined,
  result: unknown,
): Record<string, unknown> {
  if (explicit && typeof explicit === "object") return explicit;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return result === null || result === undefined ? {} : { result };
}

/** آخر رصد دائم للخطوة من سياقات checkpoints (استرداد mid-step). */
function lastObservation(repos: Repos, taskId: string, stepId: string): Record<string, unknown> | null {
  const cps = repos.tasks.listCheckpoints(taskId);
  for (let i = cps.length - 1; i >= 0; i -= 1) {
    const cp = cps[i];
    if (cp.stepId !== stepId) continue;
    const obs = (cp.context as Record<string, unknown>)?.observation;
    if (obs && typeof obs === "object" && !Array.isArray(obs)) {
      return obs as Record<string, unknown>;
    }
  }
  return null;
}

/** حجب المفاتيح الحساسة قبل التسجيل — نسخة محلية (لا استيراد خاص من المحرك). */
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
