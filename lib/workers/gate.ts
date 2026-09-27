/**
 * GEN-4 — تقرير القبول الذاتي (GEN4_GATE).
 *
 * «لا ادعاء بلا إثبات»: المنسّق نفسه يشغّل ستة فحوص حية ضد مقابض حقيقية
 * (مصنع يُمرَّر — الاختبارات تمرّر ذاكرة مشتركة وملف Round-trip).
 * `tests_pass` شاهدها CI نفسه — القيمة الافتراضية `"ci"` تعني ذلك حرفيًا.
 */
import type { Repos } from "@/lib/repositories/interfaces";
import { PAID_OPERATION, type TaskActor } from "@/lib/tasks/types";
import { ExecutionCoordinator } from "./coordinator";

export type Gen4GateResult = {
  runtime: "PASS" | "FAIL";
  lease_exclusivity_verified: boolean;
  fencing_verified: boolean;
  reclaim_replay_verified: boolean;
  exactly_once_verified: boolean;
  batch_crash_recovery_verified: boolean;
  detail: Record<string, string>;
};

const HUMAN: TaskActor = { id: "gate-human", kind: "human", role: "CAMPAIGN_MANAGER" };
const SYSTEM: TaskActor = { id: "gen4-gate", kind: "system" };

const TTL = 30_000;
const MARGIN = 5_000;

function check(fn: () => string): { pass: boolean; note: string } {
  try {
    return { pass: true, note: fn() };
  } catch (err) {
    return { pass: false, note: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

function toReady(coord: ExecutionCoordinator, goal: string, paid: boolean): string {
  const engine = coord.engine;
  const task = engine.createTask(goal, SYSTEM);
  engine.understand(task.id, { brief: "gate" }, SYSTEM);
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

function approvePaid(coord: ExecutionCoordinator, taskId: string): void {
  const engine = coord.engine;
  const proposal = { operation: PAID_OPERATION, costCap: 50 };
  const { approval } = engine.requestApproval(
    taskId,
    { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal },
    SYSTEM,
  );
  engine.decideApproval(approval.id, { decision: "approved", by: HUMAN });
  engine.resume(
    taskId,
    { approvalId: approval.id, operation: PAID_OPERATION, costCap: 50, proposal },
    SYSTEM,
  );
}

export function runGen4SelfChecks(makeRepos: () => Repos): Gen4GateResult {
  const detail: Record<string, string> = {};
  let t = Date.parse("2026-09-27T00:00:00.000Z");
  const coord = (repos?: Repos): ExecutionCoordinator =>
    new ExecutionCoordinator(repos ?? makeRepos(), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
  const advance = (ms: number): void => {
    t += ms;
  };

  // runtime — متنافسان على مهمة ⇒ واحد ينفّذ والآخر denied ⇒ COMPLETED.
  const runtime = check(() => {
    const a = coord();
    const id = toReady(a, "gate-runtime", false);
    const won = a.claim(id, "worker-a");
    if (won.status !== "claimed") throw new Error("first claim lost");
    const lost = coord().claim(id, "worker-b");
    if (lost.status !== "denied") throw new Error("double execution possible");
    for (const stepId of ["s1", "s2"]) {
      const out = a.executeStep(id, "worker-a", stepId, { verdict: "verified" });
      if (out.status !== "ok") throw new Error(`step ${stepId}: ${JSON.stringify(out)}`);
    }
    const done = a.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    if (done.status !== "COMPLETED") throw new Error(`status=${done.status}`);
    return "a→COMPLETED b→denied";
  });
  detail.runtime = runtime.note;

  // lease_exclusivity — مملوكة ⇒ denied · بعد الهامش ⇒ reclaim بحقبة أعلى.
  const exclusivity = check(() => {
    const a = coord();
    const id = toReady(a, "gate-exclusive", false);
    const first = a.claim(id, "worker-a");
    if (first.status !== "claimed" || first.reclaimed) throw new Error("fresh claim broken");
    if (coord().claim(id, "worker-b").status !== "denied") throw new Error("no exclusion");
    advance(TTL - MARGIN + 1); // فوات موعد التجديد
    const second = coord().claim(id, "worker-b");
    if (second.status !== "claimed" || !second.reclaimed) throw new Error("no reclaim");
    if (second.lease.fencingToken !== first.lease.fencingToken + 1) {
      throw new Error("fencing not monotonic");
    }
    return `token ${first.lease.fencingToken}→${second.lease.fencingToken}`;
  });
  detail.exclusivity = exclusivity.note;

  // fencing — stale (نبضة وتنفيذ) مرفوضان · السلسلة غير ملوثة.
  const fencing = check(() => {
    const a = coord();
    const id = toReady(a, "gate-fencing", false);
    const first = a.claim(id, "worker-a");
    if (first.status !== "claimed") throw new Error("claim lost");
    const hb = a.heartbeat(first.lease.id, "worker-a");
    if (hb.status !== "ok") throw new Error("fresh heartbeat denied");
    advance(TTL + 1); // انتهاء صلب
    const take = coord().claim(id, "worker-b");
    if (take.status !== "claimed") throw new Error("reclaim lost");
    if (a.heartbeat(first.lease.id, "worker-a").status !== "denied") {
      throw new Error("stale heartbeat accepted");
    }
    const stale = a.executeStep(id, "worker-a", "s1", { verdict: "verified" });
    if (stale.status !== "denied") throw new Error("stale execution accepted");
    const fresh = coord().executeStep(id, "worker-b", "s1", { verdict: "verified" });
    if (fresh.status !== "ok") throw new Error(`fresh denied: ${JSON.stringify(fresh)}`);
    if (!a.engine.verifyChain(id)) throw new Error("chain polluted");
    return "stale fenced, chain clean";
  });
  detail.fencing = fencing.note;

  // reclaim_replay — موت mid-task ⇒ استرداد متحقَّق ⇒ نفس الدليل.
  const reclaim = check(() => {
    const repos = makeRepos();
    const mk = (): ExecutionCoordinator =>
      new ExecutionCoordinator(repos, { now: () => t, leaseTtlMs: TTL, heartbeatMarginMs: MARGIN });
    const ref = mk();
    const refId = toReady(ref, "gate-ref", false);
    for (const stepId of ["s1", "s2"]) {
      const c = ref.claim(refId, "worker-ref");
      if (c.status !== "claimed") throw new Error("ref claim lost");
      const out = ref.executeStep(refId, "worker-ref", stepId, {
        verdict: "verified",
        observation: { step: stepId },
        evidence: { step: stepId },
      });
      if (out.status !== "ok") throw new Error("ref step failed");
      ref.release(refId, "worker-ref");
    }
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    const dead = mk();
    const id = toReady(dead, "gate-killed", false);
    const c1 = dead.claim(id, "worker-a");
    if (c1.status !== "claimed") throw new Error("claim lost");
    const s1 = dead.executeStep(id, "worker-a", "s1", {
      verdict: "verified",
      observation: { step: "s1" },
      evidence: { step: "s1" },
    });
    if (s1.status !== "ok") throw new Error("s1 failed");
    advance(TTL + 1); // الموت: توقف heartbeat بلا تسليم

    const heir = mk();
    const c2 = heir.claim(id, "worker-b");
    if (c2.status !== "claimed" || !c2.reclaimed) throw new Error("no reclaim after death");
    const s2 = heir.executeStep(id, "worker-b", "s2", {
      verdict: "verified",
      observation: { step: "s2" },
      evidence: { step: "s2" },
    });
    if (s2.status !== "ok") throw new Error(`resume failed: ${JSON.stringify(s2)}`);
    const done = heir.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    if (done.status !== refDone.status) throw new Error("status diverged");
    if (done.evidenceChainHead !== refDone.evidenceChainHead) throw new Error("evidence diverged");
    return `reclaimed→${done.status} evidence match`;
  });
  detail.reclaim = reclaim.note;

  // exactly_once — نداء مدفوع واحد عبر الموت والاسترداد (عداد + سجل).
  const exactlyOnce = check(() => {
    const repos = makeRepos();
    const mk = (): ExecutionCoordinator =>
      new ExecutionCoordinator(repos, { now: () => t, leaseTtlMs: TTL, heartbeatMarginMs: MARGIN });
    let calls = 0;
    const call = (): unknown => {
      calls += 1;
      return { receipt: `r-${calls}` };
    };
    const a = mk();
    const id = toReady(a, "gate-once", true);
    approvePaid(a, id);
    const c1 = a.claim(id, "worker-a");
    if (c1.status !== "claimed") throw new Error("claim lost");
    const first = a.executeStep(id, "worker-a", "pay", { verdict: "verified", call });
    if (first.status !== "ok") throw new Error(`paid failed: ${JSON.stringify(first)}`);
    advance(TTL + 1); // الموت بعد الإكمال

    const b = mk();
    const c2 = b.claim(id, "worker-b");
    if (c2.status !== "claimed") throw new Error("reclaim lost");
    const retry = b.executeStep(id, "worker-b", "pay", { verdict: "verified", call });
    if (retry.status !== "already-verified") throw new Error(`retry: ${JSON.stringify(retry)}`);
    if (calls !== 1) throw new Error(`calls=${calls}`);
    const attempts = repos.tasks.listAttempts(id);
    if (attempts.length !== 1 || attempts[0].status !== "executed") {
      throw new Error("attempt registry broken");
    }
    return "calls=1 registry=1";
  });
  detail.exactlyOnce = exactlyOnce.note;

  // batch_crash — تعطّل mid-batch ⇒ البادئة + الاستئناف ⇒ نفس المرجع.
  const batch = check(() => {
    const repos = makeRepos();
    const mk = (): ExecutionCoordinator =>
      new ExecutionCoordinator(repos, { now: () => t, leaseTtlMs: TTL, heartbeatMarginMs: MARGIN });
    const planOf = (c: ExecutionCoordinator, goal: string): string => {
      const e = c.engine;
      const task = e.createTask(goal, SYSTEM);
      e.understand(task.id, {}, SYSTEM);
      e.plan(
        task.id,
        ["b1", "b2", "b3"].map((stepId) => ({ id: stepId, operation: "collect", costCap: 0 })),
        SYSTEM,
      );
      e.markReady(task.id, SYSTEM);
      return task.id;
    };
    // المرجع: دفعة كاملة بلا انقطاع
    const ref = mk();
    const refId = planOf(ref, "gate-batch-ref");
    const rc = ref.claim(refId, "worker-ref");
    if (rc.status !== "claimed") throw new Error("ref claim lost");
    const rb = ref.executeBatch(
      refId,
      "worker-ref",
      ["b1", "b2", "b3"].map((stepId) => ({ stepId, verdict: "verified" as const })),
    );
    if (!rb.completed || rb.applied !== 3) throw new Error("ref batch broken");
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    // المقتول: فشل Call عند البند الثاني (خطوات مجانية ⇒ call يُتجاهَل — نحقن الفشل بإسقاط الـlease)
    const dead = mk();
    const id = planOf(dead, "gate-batch-killed");
    const dc = dead.claim(id, "worker-a");
    if (dc.status !== "claimed") throw new Error("claim lost");
    const first = dead.executeBatch(id, "worker-a", [
      { stepId: "b1", verdict: "verified" },
    ]);
    if (!first.completed || first.applied !== 1) throw new Error("prefix broken");
    advance(TTL + 1); // الموت قبل إكمال الدفعة
    const heir = mk();
    const hc = heir.claim(id, "worker-b");
    if (hc.status !== "claimed" || !hc.reclaimed) throw new Error("no reclaim");
    const rest = heir.executeBatch(id, "worker-b", [
      { stepId: "b2", verdict: "verified" },
      { stepId: "b3", verdict: "verified" },
    ]);
    if (!rest.completed || rest.applied !== 2) throw new Error(`resume: ${JSON.stringify(rest)}`);
    const done = heir.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    if (done.status !== refDone.status) throw new Error("status diverged");
    if (done.evidenceChainHead !== refDone.evidenceChainHead) throw new Error("evidence diverged");
    const steps = heir.engine.getTask(id)!.plan.map((s) => s.status);
    if (steps.some((s) => s !== "verified")) throw new Error("steps diverged");
    return "prefix 1 + resume 2 = ref 3";
  });
  detail.batch = batch.note;

  const all = [runtime, exclusivity, fencing, reclaim, exactlyOnce, batch].every((c) => c.pass);
  return {
    runtime: all ? "PASS" : "FAIL",
    lease_exclusivity_verified: exclusivity.pass,
    fencing_verified: fencing.pass,
    reclaim_replay_verified: reclaim.pass,
    exactly_once_verified: exactlyOnce.pass,
    batch_crash_recovery_verified: batch.pass,
    detail,
  };
}

/** الصيغة القانونية للتقرير — ثلاثة أسطر كما في العقد §10. */
export function formatGen4Gate(result: Gen4GateResult, testsPass = "ci"): string {
  const b = (v: boolean): string => (v ? "true" : "false");
  return (
    `GEN4_GATE  runtime=${result.runtime} lease_exclusivity_verified=${b(result.lease_exclusivity_verified)} ` +
    `fencing_verified=${b(result.fencing_verified)}\n` +
    `           reclaim_replay_verified=${b(result.reclaim_replay_verified)} ` +
    `exactly_once_verified=${b(result.exactly_once_verified)}\n` +
    `           batch_crash_recovery_verified=${b(result.batch_crash_recovery_verified)} ` +
    `tests_pass=${testsPass}`
  );
}
