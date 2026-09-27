/**
 * GEN-3 — اختبارات المحرك التكاملية: الحلقة الكاملة + الاختبارات الحاسمة الأربعة.
 *
 *  1. قتل أثناء EXECUTING → استئناف ⇒ نفس نتيجة المتواصل.
 *  2. مدفوعة بلا منح ⇒ WAITING_APPROVAL ⇒ اعتماد ⇒ COMPLETED.
 *  3. نفسها + رفض ⇒ BLOCKED أو REPLANNING (أبدًا استمرار صامت).
 *  4. تحقق جزئي بلا بدائل ⇒ PARTIAL أبدًا COMPLETED.
 */
import { describe, it, expect } from "vitest";
import { createMemoryRepos, emptyStore, reposFromStore } from "@/lib/persistence/memory";
import type { Repos } from "@/lib/repositories/interfaces";
import { TaskEngine } from "@/lib/tasks/engine";
import { PAID_OPERATION, TaskEngineError, type TaskActor } from "@/lib/tasks/types";
import { formatGen3Gate, runGen3SelfChecks } from "@/lib/tasks/gate";

const HUMAN: TaskActor = { id: "user-manager", kind: "human", role: "CAMPAIGN_MANAGER" };
const AGENT: TaskActor = { id: "agent-1", kind: "agent" };
const SYSTEM: TaskActor = { id: "test", kind: "system" };

function fresh(ttlMs?: number): { repos: Repos; engine: TaskEngine; advance: (ms: number) => void } {
  let t = Date.parse("2026-09-27T00:00:00.000Z");
  const repos = createMemoryRepos();
  const engine = new TaskEngine(repos, { now: () => t, ...(ttlMs ? { approvalTtlMs: ttlMs } : {}) });
  return { repos, engine, advance: (ms: number) => { t += ms; } };
}

function toReady(engine: TaskEngine, goal: string, steps = ["s1", "s2"]): string {
  const task = engine.createTask(goal, SYSTEM);
  engine.understand(task.id, { brief: "b" }, SYSTEM);
  engine.plan(task.id, steps.map((id) => ({ id, operation: "collect", costCap: 0 })), SYSTEM);
  engine.markReady(task.id, SYSTEM);
  return task.id;
}

function runFreeStep(
  engine: TaskEngine,
  taskId: string,
  stepId: string,
  verdict: "verified" | "failed" = "verified",
): void {
  engine.beginExecution(taskId, stepId, SYSTEM);
  engine.observeStep(taskId, stepId, { ok: verdict === "verified" }, SYSTEM);
  engine.verifyStep(taskId, stepId, { verdict, evidence: { step: stepId } }, SYSTEM);
}

describe("tasks-engine: المسار السعيد", () => {
  it("create→…→COMPLETED بسلسلة سليمة وتدقيق كامل", () => {
    const { repos, engine } = fresh();
    const id = toReady(engine, "مسح ميداني");
    runFreeStep(engine, id, "s1");
    runFreeStep(engine, id, "s2");
    const done = engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");
    expect(engine.verifyChain(id)).toBe(true);
    const actions = repos.audit.list().map((e) => e.action);
    expect(actions).toContain("task.create");
    expect(actions).toContain("task.transition");
    // كل انتقال موثّق — بعدد checkpoints تمامًا
    expect(actions.filter((a) => a === "task.transition")).toHaveLength(engine.checkpoints(id).length - 1);
  });

  it("خطوة verified بلا منح مجاني تعمل — ومدفوعة بلا منح ⇒ NEEDS_APPROVAL (R6)", () => {
    const { engine } = fresh();
    const task = engine.createTask("مدفوعة", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    try {
      engine.beginExecution(task.id, "pay", SYSTEM);
      throw new Error("expected NEEDS_APPROVAL");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("task.needs_approval");
    }
    expect(engine.getTask(task.id)!.status).toBe("READY");
  });
});

describe("tasks-engine [حاسم 1]: القتل أثناء EXECUTING ⇒ نفس نتيجة المتواصل", () => {
  it("kill → resume ⇒ (status + evidence + artifacts + context) متطابقة", () => {
    // التشغيل المتواصل المرجعي
    const ref = fresh();
    const refId = toReady(ref.engine, "مرجع");
    runFreeStep(ref.engine, refId, "s1");
    runFreeStep(ref.engine, refId, "s2");
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    // التشغيل المقتول: تقدُّم حتى قلب EXECUTING ثم إسقاط المحرك (قتل العملية)
    const cut = fresh();
    const cutId = toReady(cut.engine, "مرجع");
    cut.engine.beginExecution(cutId, "s1", SYSTEM);
    cut.engine.observeStep(cutId, "s1", { ok: true }, SYSTEM);
    cut.engine.verifyStep(cutId, "s1", { verdict: "verified", evidence: { step: "s1" } }, SYSTEM);
    cut.engine.beginExecution(cutId, "s2", SYSTEM);
    // …القتل هنا: نفس المخزن، محرك جديد (عملية جديدة)…
    const revived = new TaskEngine(cut.repos, { now: () => Date.parse("2026-09-27T00:00:00.000Z") });
    const resumed = revived.resumeAfterKill(cutId, SYSTEM);
    expect(resumed.task.status).toBe("EXECUTING");
    expect(resumed.context).toMatchObject({ stepId: "s2" });
    revived.observeStep(cutId, "s2", { ok: true }, SYSTEM);
    revived.verifyStep(cutId, "s2", { verdict: "verified", evidence: { step: "s2" } }, SYSTEM);
    const cutDone = revived.conclude(cutId, { alternativesAvailable: false }, SYSTEM);

    expect(cutDone.status).toBe(refDone.status);
    expect(cutDone.evidenceChainHead).toBe(refDone.evidenceChainHead);
    // الرأس مرتبط بـtaskId تصميمًا — ما يُقارَن سلامته داخليًا لا تطابقه عبر مهام
    expect(cut.engine.verifyChain(cutId)).toBe(true);
    expect(ref.engine.verifyChain(refId)).toBe(true);
    expect(revived.checkpoints(cutId).length).toBe(ref.engine.checkpoints(refId).length);
    expect(revived.artifacts(cutId)).toHaveLength(ref.engine.artifacts(refId).length);
    expect(revived.replay(cutId).context).toEqual(ref.engine.replay(refId).context);
    expect(revived.verifyChain(cutId)).toBe(true);
  });

  it("سلسلة مكسورة بعد القتل ⇒ الاستئناف مرفوض (fail-closed)", () => {
    const { repos, engine } = fresh();
    const id = toReady(engine, "عبث");
    engine.beginExecution(id, "s1", SYSTEM);
    // عبث مباشر في المخزن (ما وراء المحرك)
    const cps = repos.tasks.listCheckpoints(id);
    (cps[0].context as Record<string, unknown>).goal = "مزوَّر";
    const revived = new TaskEngine(repos);
    expect(() => revived.resumeAfterKill(id, SYSTEM)).toThrowError(/مكسورة/);
    try {
      revived.resumeAfterKill(id, SYSTEM);
      throw new Error("expected integrity");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("task.integrity");
    }
  });
});

describe("tasks-engine [حاسم 2]: مدفوعة ⇒ انتظار ⇒ اعتماد ⇒ COMPLETED", () => {
  const proposal = { operation: PAID_OPERATION, costCap: 50, args: { q: 1 } };

  it("الدورة الكاملة للمنح الأحادي", () => {
    const { repos, engine } = fresh();
    const task = engine.createTask("شراء بيانات", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);

    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    expect(approval.status).toBe("pending");
    expect(engine.getTask(task.id)!.status).toBe("WAITING_APPROVAL");
    expect(approval.proposalHash).toMatch(/^[0-9a-f]{64}$/);

    const decided = engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
    expect(decided.approval.status).toBe("approved");
    expect(decided.grant).not.toBeNull();
    // ما زالت تنتظر حتى resume (R2)
    expect(engine.getTask(task.id)!.status).toBe("WAITING_APPROVAL");

    const resumed = engine.resume(
      task.id, { approvalId: approval.id, operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    expect(resumed.status).toBe("READY");

    engine.beginExecution(task.id, "pay", SYSTEM);
    engine.observeStep(task.id, "pay", { receipt: "r1" }, SYSTEM);
    engine.verifyStep(task.id, "pay", { verdict: "verified", evidence: { paid: true } }, SYSTEM);
    const done = engine.conclude(task.id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");

    const actions = repos.audit.list().map((e) => e.action);
    for (const a of ["task.approval.requested", "task.approval.granted", "task.grant.consumed"]) {
      expect(actions).toContain(a);
    }
  });

  it("طلب الموافقة خارج PLANNING/READY ⇒ رفض (R1) — بلا تخزين طلب", () => {
    const { engine } = fresh();
    const id = toReady(engine, "مبكر");
    engine.beginExecution(id, "s1", SYSTEM);
    try {
      engine.requestApproval(id, { stepId: "s1", operation: "collect", costCap: 0, proposal: {} }, SYSTEM);
      throw new Error("expected illegal");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("task.transition.illegal");
    }
    expect(engine.approvals(id)).toHaveLength(0);
  });
});

describe("tasks-engine [حاسم 3]: الرفض ⇒ BLOCKED أو REPLANNING — أبدًا صمت", () => {
  const proposal = { operation: PAID_OPERATION, costCap: 50 };

  it("رفض بلا بديل ⇒ BLOCKED نهائي بلا retry (R4)", () => {
    const { engine } = fresh();
    const task = engine.createTask("مرفوضة", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    const settled = engine.decideApproval(approval.id, { decision: "rejected", by: HUMAN });
    expect(settled.task.status).toBe("BLOCKED");
    // لا استمرار صامت ولا retry
    for (const fn of [
      () => engine.resume(task.id, { approvalId: approval.id, operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM),
      () => engine.beginExecution(task.id, "pay", SYSTEM),
      () => engine.markReady(task.id, SYSTEM),
    ]) {
      expect(fn).toThrowError(TaskEngineError);
    }
    expect(engine.getTask(task.id)!.status).toBe("BLOCKED");
  });

  it("رفض ببديل ⇒ REPLANNING ⇒ replan ⇒ READY ⇒ COMPLETED", () => {
    const { engine } = fresh();
    const task = engine.createTask("بديلة", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    const settled = engine.decideApproval(
      approval.id, { decision: "rejected", by: HUMAN, alternativesAvailable: true },
    );
    expect(settled.task.status).toBe("REPLANNING");
    // خطة بديلة مجانية
    engine.replan(task.id, [{ id: "free", operation: "collect", costCap: 0 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    runFreeStep(engine, task.id, "free");
    const done = engine.conclude(task.id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");
  });

  it("قرار مكرر على طلب محسوم ⇒ رفض (لا تراجع صامت)", () => {
    const { engine } = fresh();
    const task = engine.createTask("مكرر", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    engine.decideApproval(approval.id, { decision: "rejected", by: HUMAN });
    try {
      engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
      throw new Error("expected decided");
    } catch (err) {
      // المهمة غادرت الانتظار ⇒ task.state أولًا (fail-closed قبل فحص الطلب)
      expect((err as TaskEngineError).code).toBe("task.state");
    }
  });
});

describe("tasks-engine [حاسم 4]: تحقق جزئي بلا بدائل ⇒ PARTIAL أبدًا COMPLETED", () => {
  it("خطوة ناجحة + فاشلة + لا بدائل ⇒ PARTIAL", () => {
    const { engine } = fresh();
    const id = toReady(engine, "جزئية");
    runFreeStep(engine, id, "s1", "verified");
    runFreeStep(engine, id, "s2", "failed");
    const done = engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("PARTIAL");
    expect(done.status).not.toBe("COMPLETED");
  });

  it("نفسها + بدائل ⇒ RECOVERING (لا COMPLETED ولا PARTIAL)", () => {
    const { engine } = fresh();
    const id = toReady(engine, "قابلة للاسترداد");
    runFreeStep(engine, id, "s1", "verified");
    runFreeStep(engine, id, "s2", "failed");
    const done = engine.conclude(id, { alternativesAvailable: true }, SYSTEM);
    expect(done.status).toBe("RECOVERING");
  });

  it("الحكم من VERIFYING فقط — المتصل لا يختار الحالة (R3)", () => {
    const { engine } = fresh();
    const id = toReady(engine, "مبكرة");
    expect(() => engine.conclude(id, { alternativesAvailable: false }, SYSTEM)).toThrowError(TaskEngineError);
    expect(engine.getTask(id)!.status).toBe("READY");
  });
});

describe("tasks-engine: صلابة المنح (R2 + أحادي + بشري)", () => {
  const proposal = { operation: PAID_OPERATION, costCap: 50, args: { q: 1 } };

  function waiting(): { engine: TaskEngine; taskId: string; approvalId: string; advance: (ms: number) => void } {
    const { engine, advance } = fresh();
    const task = engine.createTask("منح", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
    return { engine, taskId: task.id, approvalId: approval.id, advance };
  }

  it("عدم تطابق المقترح ⇒ DENY فوري وتبقى WAITING_APPROVAL", () => {
    const { engine, taskId, approvalId } = waiting();
    const bad = { operation: PAID_OPERATION, costCap: 50, args: { q: 2 } };
    try {
      engine.resume(taskId, { approvalId, operation: PAID_OPERATION, costCap: 50, proposal: bad }, SYSTEM);
      throw new Error("expected mismatch");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("approval.mismatch");
    }
    expect(engine.getTask(taskId)!.status).toBe("WAITING_APPROVAL");
  });

  it("عدم تطابق operation أو costCap ⇒ DENY فوري", () => {
    const w1 = waiting();
    expect(() =>
      w1.engine.resume(
        w1.taskId, { approvalId: w1.approvalId, operation: "أخرى", costCap: 50, proposal }, SYSTEM,
      ),
    ).toThrowError(/DENY/);
    const w2 = waiting();
    expect(() =>
      w2.engine.resume(
        w2.taskId, { approvalId: w2.approvalId, operation: PAID_OPERATION, costCap: 51, proposal }, SYSTEM,
      ),
    ).toThrowError(/DENY/);
    expect(w1.engine.getTask(w1.taskId)!.status).toBe("WAITING_APPROVAL");
    expect(w2.engine.getTask(w2.taskId)!.status).toBe("WAITING_APPROVAL");
  });

  it("المنح أحادي — استئناف بمنح قديم مُستهلَك ⇒ DENY", () => {
    const { engine, taskId, approvalId } = waiting();
    engine.resume(taskId, { approvalId, operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM);
    // جولة ثانية بموافقة جديدة…
    const { approval: second } = engine.requestApproval(
      taskId, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    engine.decideApproval(second.id, { decision: "approved", by: HUMAN });
    // …ثم محاولة بالمنح الأول المُستهلَك
    try {
      engine.resume(taskId, { approvalId, operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM);
      throw new Error("expected consumed");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("grant.consumed");
    }
    expect(engine.getTask(taskId)!.status).toBe("WAITING_APPROVAL");
  });

  it("قرار غير بشري ⇒ رفض مسجَّل (D4)", () => {
    const { repos, engine } = fresh();
    const task = engine.createTask("غير بشرية", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    try {
      engine.decideApproval(approval.id, { decision: "approved", by: AGENT });
      throw new Error("expected not_human");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("approval.not_human");
    }
    expect(repos.audit.list().map((e) => e.action)).toContain("task.approval.denied_attempt");
    expect(engine.getTask(task.id)!.status).toBe("WAITING_APPROVAL");
  });

  it("سقف المنح يُحترَم — تجاوز التكلفة ⇒ NEEDS_APPROVAL رغم الاستئناف", () => {
    const { engine } = fresh();
    const task = engine.createTask("سقف", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    // الخطة تطلب 50 لكن الموافقة صدرت على 10 فقط
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const cheap = { operation: PAID_OPERATION, costCap: 10 };
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 10, proposal: cheap }, SYSTEM,
    );
    engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
    engine.resume(task.id, { approvalId: approval.id, operation: PAID_OPERATION, costCap: 10, proposal: cheap }, SYSTEM);
    try {
      engine.beginExecution(task.id, "pay", SYSTEM);
      throw new Error("expected needs_approval");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("task.needs_approval");
    }
  });
});

describe("tasks-engine: الانتهاء (TTL + fail-closed)", () => {
  const proposal = { operation: PAID_OPERATION, costCap: 50 };

  it("اعتماد بعد الانتهاء ⇒ يُعامَل منتهيًا ⇒ BLOCKED (لا COMPLETED لاحقًا)", () => {
    const { engine, advance } = fresh(60_000);
    const task = engine.createTask("منتهية", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    advance(61_000);
    const settled = engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
    expect(settled.approval.status).toBe("expired");
    expect(settled.grant).toBeNull();
    expect(settled.task.status).toBe("BLOCKED");
  });

  it("استئناف على منتهية ⇒ تسوية + رفض", () => {
    const { engine, advance } = fresh(60_000);
    const task = engine.createTask("استئناف منتهٍ", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    advance(61_000);
    try {
      engine.resume(task.id, { approvalId: approval.id, operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM);
      throw new Error("expected expired");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("approval.expired");
    }
    expect(engine.getTask(task.id)!.status).toBe("BLOCKED");
  });

  it("settleExpired ببديل ⇒ REPLANNING", () => {
    const { engine, advance } = fresh(60_000);
    const task = engine.createTask("تسوية", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    advance(61_000);
    const { task: settled, expired } = engine.settleExpired(task.id, { alternativesAvailable: true }, SYSTEM);
    expect(expired).toBe(1);
    expect(settled.status).toBe("REPLANNING");
  });
});

describe("tasks-engine: Artifacts (§8)", () => {
  it("من VERIFIED فقط — مرفوضة من failed قبل أي أثر", () => {
    const { engine } = fresh();
    const id = toReady(engine, "artifacts");
    runFreeStep(engine, id, "s1", "verified");
    engine.beginExecution(id, "s2", SYSTEM);
    engine.observeStep(id, "s2", {}, SYSTEM);
    try {
      engine.verifyStep(id, "s2", { verdict: "failed", artifact: { type: "x", ref: "y" } }, SYSTEM);
      throw new Error("expected unverified");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("artifact.unverified");
    }
    expect(engine.artifacts(id)).toHaveLength(0);
    expect(engine.getTask(id)!.status).toBe("OBSERVING");
  });

  it("مربوطة بـstepId+evidenceHash ومتاحة في PARTIAL", () => {
    const { engine } = fresh();
    const id = toReady(engine, "partial-artifacts");
    engine.beginExecution(id, "s1", SYSTEM);
    engine.observeStep(id, "s1", {}, SYSTEM);
    engine.verifyStep(
      id, "s1",
      { verdict: "verified", evidence: { ok: 1 }, artifact: { type: "report", ref: "r1" } },
      SYSTEM,
    );
    runFreeStep(engine, id, "s2", "failed");
    const done = engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("PARTIAL");
    const arts = engine.artifacts(id);
    expect(arts).toHaveLength(1);
    expect(arts[0].stepId).toBe("s1");
    expect(arts[0].evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("متاحة في BLOCKED أيضًا (غير مقيَّدة بالنجاح)", () => {
    const { engine } = fresh();
    const proposal = { operation: PAID_OPERATION, costCap: 50 };
    const task = engine.createTask("blocked-artifacts", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(
      task.id,
      [
        { id: "free", operation: "collect", costCap: 0 },
        { id: "pay", operation: PAID_OPERATION, costCap: 50 },
      ],
      SYSTEM,
    );
    engine.markReady(task.id, SYSTEM);
    engine.beginExecution(task.id, "free", SYSTEM);
    engine.observeStep(task.id, "free", {}, SYSTEM);
    engine.verifyStep(
      task.id, "free",
      { verdict: "verified", evidence: { ok: 1 }, artifact: { type: "note", ref: "n1" } },
      SYSTEM,
    );
    const { approval } = engine.requestApproval(
      task.id, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    engine.decideApproval(approval.id, { decision: "rejected", by: HUMAN });
    expect(engine.getTask(task.id)!.status).toBe("BLOCKED");
    expect(engine.artifacts(task.id)).toHaveLength(1);
  });
});

describe("tasks-engine: §5 والتطهير", () => {
  it("مقترح يحمل حقلًا سياسيًا ⇒ رفض صريح (§5)", () => {
    const { engine } = fresh();
    const task = engine.createTask("§5", SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 1 }], SYSTEM);
    engine.markReady(task.id, SYSTEM);
    try {
      engine.requestApproval(
        task.id,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 1, proposal: { political_score: 9 } },
        SYSTEM,
      );
      throw new Error("expected forbidden");
    } catch (err) {
      expect((err as TaskEngineError).code).toBe("task.forbidden");
    }
    expect(engine.getTask(task.id)!.status).toBe("READY");
  });

  it("رصد يحمل حقلًا سياسيًا ⇒ رفض — وكلمات السر تُحجَب في السياق", () => {
    const { engine } = fresh();
    const id = toReady(engine, "تطهير");
    engine.beginExecution(id, "s1", SYSTEM);
    expect(() => engine.observeStep(id, "s1", { persuadability_score: 3 }, SYSTEM)).toThrowError(
      TaskEngineError,
    );
    engine.observeStep(id, "s1", { password: "سرّ", note: "عادي" }, SYSTEM);
    const last = engine.checkpoints(id).at(-1)!;
    expect(last.context).toMatchObject({ observation: { password: "***", note: "عادي" } });
  });
});

describe("tasks-engine: GEN3_GATE", () => {
  it("الفحوص الذاتية كلها true — مقابض متعددة لنفس المخزن", () => {
    // نفس دلالات إعادة الفتح: كائن repos جديد على نفس المستند المشترك
    const store = emptyStore();
    const result = runGen3SelfChecks(() => reposFromStore(store));
    expect(result).toMatchObject({
      runtime: "PASS",
      persistence_verified: true,
      resume_verified: true,
      approval_flow_verified: true,
      partial_verified: true,
      artifacts_verified: true,
    });
  });

  it("الصيغة القانونية ثلاثة أسطر كما في العقد §11", () => {
    const store = emptyStore();
    const result = runGen3SelfChecks(() => reposFromStore(store));
    const text = formatGen3Gate(result);
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^GEN3_GATE  runtime=PASS persistence_verified=true resume_verified=true$/);
    expect(lines[1]).toMatch(/^           approval_flow_verified=true partial_verified=true$/);
    expect(lines[2]).toMatch(/^           artifacts_verified=true tests_pass=ci$/);
  });
});
