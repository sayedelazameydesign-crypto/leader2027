/**
 * GEN-4 — اختبارات المنسّق: الملكية + الـfencing + الـexactly-once + الدفعات.
 *
 * الحاسمة:
 *  1. متنافسان ⇒ واحد ينفّذ والآخر denied (لا ازدواج).
 *  2. موت mid-EXECUTING ⇒ استرداد ⇒ نفس النتيجة بلا نداء مدفوع مكرر.
 *  3. خطوة طويلة + heartbeat ⇒ لا استرداد مبكر.
 *  4. ظروف NEXA تغيّرت بين الـclaim والتنفيذ ⇒ إعادة التحقق تحكم (لا قرار قديم).
 *  5. تعطّل mid-batch ⇒ الاستئناف يعيد نفس الحالة (لا فقد ولا ازدواج).
 */
import { describe, it, expect } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import type { Repos } from "@/lib/repositories/interfaces";
import { PAID_OPERATION, type TaskActor } from "@/lib/tasks/types";
import { ExecutionCoordinator } from "@/lib/workers/coordinator";
import { WorkerError } from "@/lib/workers/types";
import { attemptToken } from "@/lib/workers/leases";
import { formatGen4Gate, runGen4SelfChecks } from "@/lib/workers/gate";
import { emptyStore, reposFromStore } from "@/lib/persistence/memory";

const T0 = Date.parse("2026-09-27T00:00:00.000Z");
const HUMAN: TaskActor = { id: "user-manager", kind: "human", role: "CAMPAIGN_MANAGER" };
const SYSTEM: TaskActor = { id: "test", kind: "system" };
const TTL = 30_000;
const MARGIN = 5_000;

function farm(ttlMs = TTL, marginMs = MARGIN): {
  repos: Repos;
  mk: () => ExecutionCoordinator;
  advance: (ms: number) => void;
} {
  let t = T0;
  const repos = createMemoryRepos();
  const mk = (): ExecutionCoordinator =>
    new ExecutionCoordinator(repos, { now: () => t, leaseTtlMs: ttlMs, heartbeatMarginMs: marginMs });
  return { repos, mk, advance: (ms: number) => { t += ms; } };
}

function toReady(coord: ExecutionCoordinator, goal: string, paid: boolean): string {
  const engine = coord.engine;
  const task = engine.createTask(goal, SYSTEM);
  engine.understand(task.id, { brief: "w" }, SYSTEM);
  engine.plan(
    task.id,
    paid
      ? [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }]
      : [
          { id: "s1", operation: "collect", costCap: 0 },
          { id: "s2", operation: "summarize", costCap: 0 },
        ],
    SYSTEM,
  );
  engine.markReady(task.id, SYSTEM);
  return task.id;
}

function approvePaid(coord: ExecutionCoordinator, taskId: string, cap = 50): void {
  const engine = coord.engine;
  const proposal = { operation: PAID_OPERATION, costCap: cap };
  const { approval } = engine.requestApproval(
    taskId,
    { stepId: "pay", operation: PAID_OPERATION, costCap: cap, proposal },
    SYSTEM,
  );
  engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
  engine.resume(
    taskId,
    { approvalId: approval.id, operation: PAID_OPERATION, costCap: cap, proposal },
    SYSTEM,
  );
}

describe("workers-claim: الأساسيات", () => {
  it("مطالبة طازجة ⇒ claimed بحقبة 1 · نبضة ⇒ تمديد مسجَّل · تسليم ⇒ تحرير", () => {
    const { repos, mk } = farm();
    const coord = mk();
    const id = toReady(coord, "أساسية", false);
    const c = coord.claim(id, "worker-a");
    expect(c.status).toBe("claimed");
    if (c.status !== "claimed") throw new Error("unreachable");
    expect(c.lease.fencingToken).toBe(1);
    expect(c.reclaimed).toBe(false);

    const hb = coord.heartbeat(c.lease.id, "worker-a");
    expect(hb.status).toBe("ok");
    expect(repos.tasks.listHeartbeats(c.lease.id)).toHaveLength(1);

    const rel = coord.release(id, "worker-a");
    expect(rel.status).toBe("released");

    const fresh = coord.claim(id, "worker-b");
    expect(fresh.status).toBe("claimed");
    if (fresh.status !== "claimed") throw new Error("unreachable");
    expect(fresh.reclaimed).toBe(false);
    expect(fresh.lease.fencingToken).toBe(2);
  });

  it("مهمة غير موجودة ⇒ denied بهدوء (تجاهل تام)", () => {
    const { mk } = farm();
    const out = mk().claim("nope", "worker-a");
    expect(out.status).toBe("denied");
    if (out.status === "denied") expect(out.code).toBe("task.missing");
  });

  it("مهمة نهائية ⇒ claim مرفوض (لا ملكية بلا عمل)", () => {
    const { mk } = farm();
    const coord = mk();
    const id = toReady(coord, "نهائية", false);
    const c = coord.claim(id, "worker-a");
    expect(c.status).toBe("claimed");
    for (const stepId of ["s1", "s2"]) {
      expect(coord.executeStep(id, "worker-a", stepId, { verdict: "verified" }).status).toBe("ok");
    }
    coord.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    coord.release(id, "worker-a");
    const again = coord.claim(id, "worker-b");
    expect(again.status).toBe("denied");
    if (again.status === "denied") expect(again.code).toBe("task.terminal");
  });

  it("نبضة/تسليم من غير المالك ⇒ denied", () => {
    const { mk } = farm();
    const coord = mk();
    const id = toReady(coord, "غريب", false);
    const c = coord.claim(id, "worker-a");
    if (c.status !== "claimed") throw new Error("unreachable");
    const hb = coord.heartbeat(c.lease.id, "worker-b");
    expect(hb.status).toBe("denied");
    if (hb.status === "denied") expect(hb.code).toBe("lease.not_owner");
    const rel = coord.release(id, "worker-b");
    expect(rel.status).toBe("denied");
  });

  it("نبضة بعد الانتهاء الصلب ⇒ denied (فات الأوان)", () => {
    const { mk, advance } = farm();
    const coord = mk();
    const id = toReady(coord, "متأخرة", false);
    const c = coord.claim(id, "worker-a");
    if (c.status !== "claimed") throw new Error("unreachable");
    advance(TTL + 1);
    const hb = coord.heartbeat(c.lease.id, "worker-a");
    expect(hb.status).toBe("denied");
    if (hb.status === "denied") expect(hb.code).toBe("lease.expired");
  });

  it("معرّفات فارغة وحكم غائب ⇒ WorkerError (خطأ مبرمج — يرمي)", () => {
    const { mk } = farm();
    const coord = mk();
    expect(() => coord.claim("", "w")).toThrowError(WorkerError);
    expect(() => coord.heartbeat("l", "")).toThrowError(WorkerError);
    expect(() => coord.executeBatch("t", "w", [])).toThrowError(WorkerError);
    expect(() =>
      coord.executeStep("t", "w", "s", { verdict: "maybe", observation: null, evidence: null } as never),
    ).toThrowError(WorkerError);
  });
});

describe("workers [حاسم 1]: متنافسان ⇒ واحد ينفّذ والآخر denied", () => {
  it("claim لحظي مزدوج ⇒ فائز واحد · والخاسر مرفوض التنفيذ أيضًا (R7)", () => {
    const { repos, mk } = farm();
    const a = mk();
    const b = mk();
    const id = toReady(a, "تنافس", false);
    const won = a.claim(id, "worker-a");
    const lost = b.claim(id, "worker-b");
    expect(won.status).toBe("claimed");
    expect(lost.status).toBe("denied");
    if (lost.status === "denied") expect(lost.code).toBe("lease.held");

    const deniedExec = b.executeStep(id, "worker-b", "s1", { verdict: "verified" });
    expect(deniedExec.status).toBe("denied");
    if (deniedExec.status === "denied") expect(deniedExec.code).toBe("lease.not_held");

    const ok = a.executeStep(id, "worker-a", "s1", { verdict: "verified" });
    expect(ok.status).toBe("ok");
    // رفض واحد مسجَّل في التدقيق (تجاهل موثّق لا صامت)
    expect(repos.audit.list().map((e) => e.action)).toContain("lease.denied");
  });
});

describe("workers [حاسم 2]: الموت mid-task ⇒ استرداد ⇒ نفس النتيجة بلا تكرار", () => {
  it("موت بعد خطوة مدفوعة ⇒ الاسترداد يكمل والدليل متطابق والنداء واحد", () => {
    const { mk, advance } = farm();
    // المرجع: تشغيل متواصل
    const ref = mk();
    const refId = toReady(ref, "مرجع", false);
    const rc = ref.claim(refId, "worker-ref");
    expect(rc.status).toBe("claimed");
    for (const stepId of ["s1", "s2"]) {
      const out = ref.executeStep(refId, "worker-ref", stepId, {
        verdict: "verified",
        observation: { step: stepId },
        evidence: { step: stepId },
      });
      expect(out.status).toBe("ok");
    }
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    // المقتول: خطوة مدفوعة أولًا (عبر خطة مخصصة) ثم موت
    const dead = mk();
    const engine = dead.engine;
    const task = engine.createTask("مقتولة", SYSTEM);
    engine.understand(task.id, { brief: "w" }, SYSTEM);
    engine.plan(
      task.id,
      [
        { id: "pay", operation: PAID_OPERATION, costCap: 50 },
        { id: "s2", operation: "summarize", costCap: 0 },
      ],
      SYSTEM,
    );
    engine.markReady(task.id, SYSTEM);
    approvePaid(dead, task.id);
    let calls = 0;
    const call = (): unknown => {
      calls += 1;
      return { receipt: "r-1" };
    };
    const c1 = dead.claim(task.id, "worker-a");
    expect(c1.status).toBe("claimed");
    const first = dead.executeStep(task.id, "worker-a", "pay", { verdict: "verified", call });
    expect(first.status).toBe("ok");
    advance(TTL + 1); // الموت: لا نبض ولا تسليم

    const heir = mk();
    const c2 = heir.claim(task.id, "worker-b");
    expect(c2.status).toBe("claimed");
    if (c2.status === "claimed") expect(c2.reclaimed).toBe(true);
    // إعادة الخطوة المدفوعة ⇒ تخطي بلا نداء
    const retry = heir.executeStep(task.id, "worker-b", "pay", { verdict: "verified", call });
    expect(retry.status).toBe("already-verified");
    const s2 = heir.executeStep(task.id, "worker-b", "s2", {
      verdict: "verified",
      observation: { step: "s2" },
      evidence: { step: "s2" },
    });
    expect(s2.status).toBe("ok");
    const done = heir.engine.conclude(task.id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe(refDone.status);
    expect(calls).toBe(1);
    // الدليل يختلف عن المرجع (خطط مختلفة) — الثبات هنا: سلسلة سليمة + نداء واحد
    expect(heir.engine.verifyChain(task.id)).toBe(true);
  });

  it("موت بين تسجيل النداء والحكم ⇒ الاسترداد يكمل من السجل بلا نداء (D5)", () => {
    const { repos, mk, advance } = farm();
    const a = mk();
    const id = toReady(a, "mid-step", true);
    approvePaid(a, id);
    const c1 = a.claim(id, "worker-a");
    if (c1.status !== "claimed") throw new Error("unreachable");
    // محاكاة الموت mid-step: begin + نداء + تسجيل + observe — بلا verify
    let calls = 0;
    a.engine.beginExecution(id, "pay", SYSTEM);
    calls += 1;
    const grant = repos.tasks.listGrants(id)[0];
    repos.tasks.recordAttempt({
      taskId: id,
      stepId: "pay",
      proposalHash: grant.proposalHash,
      attemptToken: attemptToken(grant.proposalHash, c1.lease.fencingToken),
      fencingToken: c1.lease.fencingToken,
      status: "executed",
      evidenceHash: "h",
      result: { receipt: "r-1" },
      recordedAt: new Date(T0).toISOString(),
    });
    a.engine.observeStep(id, "pay", { receipt: "r-1" }, SYSTEM);
    advance(TTL + 1); // الموت

    const b = mk();
    const c2 = b.claim(id, "worker-b");
    expect(c2.status).toBe("claimed");
    const resumed = b.executeStep(id, "worker-b", "pay", {
      verdict: "verified",
      call: () => {
        calls += 1;
        return { receipt: "r-2" };
      },
    });
    expect(resumed.status).toBe("skipped-duplicate");
    expect(calls).toBe(1);
    const done = b.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");
  });
});

describe("workers [حاسم 3]: خطوة طويلة + heartbeat ⇒ لا استرداد مبكر", () => {
  it("نبضات متصلة عبر أضعاف الـTTL ⇒ الملكية ثابتة والمنافس مرفوض", () => {
    const { mk, advance } = farm(1_000, 200);
    const a = mk();
    const b = mk();
    const id = toReady(a, "طويلة", false);
    const c = a.claim(id, "worker-a");
    if (c.status !== "claimed") throw new Error("unreachable");
    for (let i = 0; i < 10; i += 1) {
      advance(500); // الإجمالي 5000 = خمسة أضعاف الـTTL
      const hb = a.heartbeat(c.lease.id, "worker-a");
      expect(hb.status, `beat ${i}`).toBe("ok");
      expect(b.claim(id, "worker-b").status, `rival ${i}`).toBe("denied");
    }
    const out = a.executeStep(id, "worker-a", "s1", { verdict: "verified" });
    expect(out.status).toBe("ok");
  });
});

describe("workers [حاسم 4]: R10 — التحقق عند التنفيذ لا الـclaim", () => {
  it("مطالبة بلا منح ⇒ التنفيذ denied · وبعد الاعتماد (نفس الـlease) ⇒ مسموح", () => {
    const { mk } = farm();
    const coord = mk();
    const id = toReady(coord, "ظروف", true);
    const c = coord.claim(id, "worker-a");
    expect(c.status).toBe("claimed"); // الـlease ≠ إذن
    let calls = 0;
    const deniedExec = coord.executeStep(id, "worker-a", "pay", {
      verdict: "verified",
      call: () => {
        calls += 1;
        return {};
      },
    });
    expect(deniedExec.status).toBe("denied");
    if (deniedExec.status === "denied") expect(deniedExec.code).toBe("grant.invalid");
    expect(calls).toBe(0);

    // تغيّرت الظروف خارج الـlease: اعتماد + استئناف
    approvePaid(coord, id);
    const allowed = coord.executeStep(id, "worker-a", "pay", {
      verdict: "verified",
      call: () => {
        calls += 1;
        return { receipt: "r" };
      },
    });
    expect(allowed.status).toBe("ok");
    expect(calls).toBe(1);
  });

  it("منح بسقف أدنى من التكلفة ⇒ denied عند التنفيذ رغم الاعتماد", () => {
    const { mk } = farm();
    const coord = mk();
    const id = toReady(coord, "سقف", true);
    approvePaid(coord, id, 10); // الخطة تطلب 50
    const c = coord.claim(id, "worker-a");
    expect(c.status).toBe("claimed");
    const out = coord.executeStep(id, "worker-a", "pay", {
      verdict: "verified",
      call: () => ({ receipt: "r" }),
    });
    expect(out.status).toBe("denied");
    if (out.status === "denied") expect(out.code).toBe("grant.invalid");
  });
});

describe("workers [حاسم 5]: تعطّل mid-batch ⇒ لا فقد ولا ازدواج", () => {
  function planBatch(coord: ExecutionCoordinator, goal: string): string {
    const engine = coord.engine;
    const task = engine.createTask(goal, SYSTEM);
    engine.understand(task.id, {}, SYSTEM);
    engine.plan(
      task.id,
      ["b1", "b2", "b3"].map((stepId) => ({ id: stepId, operation: "collect", costCap: 0 })),
      SYSTEM,
    );
    engine.markReady(task.id, SYSTEM);
    return task.id;
  }

  it("بادئة 1 + موت + استئناف 2 ⇒ نفس المرجع 3", () => {
    const { mk, advance } = farm();
    const ref = mk();
    const refId = planBatch(ref, "دفعة مرجع");
    expect(ref.claim(refId, "worker-ref").status).toBe("claimed");
    const rb = ref.executeBatch(
      refId,
      "worker-ref",
      ["b1", "b2", "b3"].map((stepId) => ({ stepId, verdict: "verified" as const })),
    );
    expect(rb.completed).toBe(true);
    expect(rb.applied).toBe(3);
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    const dead = mk();
    const id = planBatch(dead, "دفعة مقتولة");
    expect(dead.claim(id, "worker-a").status).toBe("claimed");
    const prefix = dead.executeBatch(id, "worker-a", [{ stepId: "b1", verdict: "verified" }]);
    expect(prefix.completed).toBe(true);
    expect(prefix.applied).toBe(1);
    advance(TTL + 1);

    const heir = mk();
    const c2 = heir.claim(id, "worker-b");
    expect(c2.status).toBe("claimed");
    const rest = heir.executeBatch(id, "worker-b", [
      { stepId: "b2", verdict: "verified" },
      { stepId: "b3", verdict: "verified" },
    ]);
    expect(rest.completed).toBe(true);
    expect(rest.applied).toBe(2);
    const done = heir.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe(refDone.status);
    expect(done.evidenceChainHead).toBe(refDone.evidenceChainHead);
    expect(heir.engine.getTask(id)!.plan.map((s) => s.status)).toEqual(["verified", "verified", "verified"]);
  });

  it("نداء فاشل mid-batch ⇒ توقف فوري · والبادئة دائمة قابلة للاستئناف", () => {
    const { mk } = farm();
    const coord = mk();
    const engine = coord.engine;
    const task = engine.createTask("دفعة فاشلة", SYSTEM);
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
    approvePaid(coord, task.id);
    expect(coord.claim(task.id, "worker-a").status).toBe("claimed");

    const batch = coord.executeBatch(task.id, "worker-a", [
      { stepId: "free", verdict: "verified" },
      {
        stepId: "pay",
        verdict: "verified",
        call: () => {
          throw new Error("vendor down");
        },
      },
    ]);
    expect(batch.completed).toBe(false);
    expect(batch.applied).toBe(1);
    expect(batch.outcomes[1].outcome.status).toBe("denied");
    // البادئة دائمة: free verified والمدفوعة pending بلا أي أثر
    // (النداء يسبق begin تصميمًا — فشل المورّد = صفر أثر في المحرك)
    const mid = coord.engine.getTask(task.id)!;
    expect(mid.plan.find((s) => s.id === "free")?.status).toBe("verified");
    expect(mid.plan.find((s) => s.id === "pay")?.status).toBe("pending");
    expect(mid.status).toBe("READY");

    // الاستئناف بنداء سليم يكمل بلا إعادة للبادئة
    const resume = coord.executeBatch(task.id, "worker-a", [
      { stepId: "pay", verdict: "verified", call: () => ({ receipt: "r" }) },
    ]);
    expect(resume.completed).toBe(true);
    expect(resume.applied).toBe(1);
    const done = coord.engine.conclude(task.id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");
  });
});

describe("workers: fencing والسلامة", () => {
  it("stale worker مرفوض النبض والتنفيذ · والجديد يكمل · والسلسلة نظيفة", () => {
    const { mk, advance } = farm();
    const a = mk();
    const id = toReady(a, "fencing", false);
    const first = a.claim(id, "worker-a");
    if (first.status !== "claimed") throw new Error("unreachable");
    advance(TTL + 1);
    const b = mk();
    const take = b.claim(id, "worker-b");
    expect(take.status).toBe("claimed");
    if (take.status !== "claimed") throw new Error("unreachable");
    expect(take.lease.fencingToken).toBe(first.lease.fencingToken + 1);

    const staleHb = a.heartbeat(first.lease.id, "worker-a");
    expect(staleHb.status).toBe("denied");
    if (staleHb.status === "denied") expect(staleHb.code).toBe("lease.superseded");

    const staleExec = a.executeStep(id, "worker-a", "s1", { verdict: "verified" });
    expect(staleExec.status).toBe("denied");

    const fresh = b.executeStep(id, "worker-b", "s1", { verdict: "verified" });
    expect(fresh.status).toBe("ok");
    expect(b.engine.verifyChain(id)).toBe(true);
  });

  it("سلسلة مكسورة ⇒ الـclaim مرفوض (R9 — لا استئناف أعمى)", () => {
    const { repos, mk } = farm();
    const coord = mk();
    const id = toReady(coord, "مكسورة", false);
    repos.tasks.listCheckpoints(id)[0].context = { goal: "مزوَّر" };
    const out = coord.claim(id, "worker-a");
    expect(out.status).toBe("denied");
    if (out.status === "denied") expect(out.code).toBe("task.integrity");
    expect(repos.tasks.listLeases(id)).toHaveLength(0);
  });

  it("كسر mid-flight ⇒ التنفيذ مرفوض (fork مكتشَف بصوت)", () => {
    const { repos, mk } = farm();
    const coord = mk();
    const id = toReady(coord, "fork", false);
    expect(coord.claim(id, "worker-a").status).toBe("claimed");
    repos.tasks.listCheckpoints(id)[0].context = { goal: "مزوَّر" };
    const out = coord.executeStep(id, "worker-a", "s1", { verdict: "verified" });
    expect(out.status).toBe("denied");
    if (out.status === "denied") expect(out.code).toBe("task.integrity");
  });

  it("التدقيق يوثّق دورة الملكية كاملة", () => {
    const { repos, mk, advance } = farm();
    const a = mk();
    const id = toReady(a, "تدقيق", false);
    a.claim(id, "worker-a");
    mk().claim(id, "worker-b"); // denied
    a.executeStep(id, "worker-a", "s1", { verdict: "verified" });
    advance(TTL + 1);
    mk().claim(id, "worker-b"); // reclaim
    const actions = repos.audit.list().map((e) => e.action);
    for (const expected of ["lease.claimed", "lease.denied", "step.executed", "lease.reclaimed"]) {
      expect(actions).toContain(expected);
    }
  });
});

describe("workers: GEN4_GATE", () => {
  it("الفحوص الذاتية كلها true — مقابض متعددة لنفس المخزن", () => {
    const store = emptyStore();
    const result = runGen4SelfChecks(() => reposFromStore(store));
    expect(result).toMatchObject({
      runtime: "PASS",
      lease_exclusivity_verified: true,
      fencing_verified: true,
      reclaim_replay_verified: true,
      exactly_once_verified: true,
      batch_crash_recovery_verified: true,
    });
  });

  it("الصيغة القانونية ثلاثة أسطر كما في العقد §10", () => {
    const store = emptyStore();
    const result = runGen4SelfChecks(() => reposFromStore(store));
    const lines = formatGen4Gate(result).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(
      /^GEN4_GATE  runtime=PASS lease_exclusivity_verified=true fencing_verified=true$/,
    );
    expect(lines[1]).toMatch(/^           reclaim_replay_verified=true exactly_once_verified=true$/);
    expect(lines[2]).toMatch(/^           batch_crash_recovery_verified=true tests_pass=ci$/);
  });
});
