/**
 * GEN-3 — تقرير القبول الذاتي (GEN3_GATE).
 *
 * «لا ادعاء بلا إثبات»: المحرك نفسه يشغّل ستة فحوص حية ضد محوّل حقيقي
 * (يمرَّر كمصنع — الاختبارات تمرّر file Round-trip، والذاكرة للسرعة).
 * `tests_pass` شاهدها CI نفسه — القيمة الافتراضية `"ci"` تعني ذلك حرفيًا.
 */
import type { Repos } from "@/lib/repositories/interfaces";
import { TaskEngine } from "./engine";
import { PAID_OPERATION, type TaskActor } from "./types";

export type Gen3GateResult = {
  runtime: "PASS" | "FAIL";
  persistence_verified: boolean;
  resume_verified: boolean;
  approval_flow_verified: boolean;
  partial_verified: boolean;
  artifacts_verified: boolean;
  detail: Record<string, string>;
};

const HUMAN: TaskActor = { id: "gate-human", kind: "human", role: "CAMPAIGN_MANAGER" };
const SYSTEM: TaskActor = { id: "gen3-gate", kind: "system" };

/** مسار سعيد كامل بلا موافقات — يُستعمل للمقارنة والفحوص. */
function driveHappy(engine: TaskEngine, goal: string): string {
  const task = engine.createTask(goal, SYSTEM);
  engine.understand(task.id, { brief: "gate" }, SYSTEM);
  engine.plan(
    task.id,
    [
      { id: "s1", operation: "collect", costCap: 0 },
      { id: "s2", operation: "summarize", costCap: 0 },
    ],
    SYSTEM,
  );
  engine.markReady(task.id, SYSTEM);
  for (const stepId of ["s1", "s2"]) {
    engine.beginExecution(task.id, stepId, SYSTEM);
    engine.observeStep(task.id, stepId, { ok: true }, SYSTEM);
    engine.verifyStep(
      task.id,
      stepId,
      { verdict: "verified", evidence: { step: stepId }, artifact: { type: "note", ref: stepId } },
      SYSTEM,
    );
  }
  return engine.conclude(task.id, { alternativesAvailable: false }, SYSTEM).id;
}

function check(fn: () => string): { pass: boolean; note: string } {
  try {
    return { pass: true, note: fn() };
  } catch (err) {
    return { pass: false, note: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

export function runGen3SelfChecks(makeRepos: () => Repos): Gen3GateResult {
  const detail: Record<string, string> = {};

  // runtime — مسار سعيد ينتهي COMPLETED بسلسلة سليمة.
  const runtime = check(() => {
    const engine = new TaskEngine(makeRepos());
    const id = driveHappy(engine, "gate-runtime");
    const task = engine.getTask(id)!;
    if (task.status !== "COMPLETED") throw new Error(`status=${task.status}`);
    if (!engine.verifyChain(id)) throw new Error("chain broken");
    return `COMPLETED checkpoints=${engine.checkpoints(id).length}`;
  });
  detail.runtime = runtime.note;

  // persistence — تقدُّم ثم مقبض جديد لنفس المخزن ⇒ نفس الحالة والسلسلة.
  const persistence = check(() => {
    const first = new TaskEngine(makeRepos());
    const task = first.createTask("gate-persist", SYSTEM);
    first.understand(task.id, {}, SYSTEM);
    first.plan(task.id, [{ id: "s1", operation: "collect", costCap: 0 }], SYSTEM);
    first.markReady(task.id, SYSTEM);
    first.beginExecution(task.id, "s1", SYSTEM);

    const second = new TaskEngine(makeRepos());
    const reloaded = second.getTask(task.id);
    if (!reloaded || reloaded.status !== "EXECUTING") throw new Error("state lost across reopen");
    if (!second.verifyChain(task.id)) throw new Error("chain broken across reopen");
    if (reloaded.checkpointHead !== first.getTask(task.id)!.checkpointHead) {
      throw new Error("head mismatch");
    }
    return `EXECUTING head=${reloaded.checkpointHead.slice(0, 12)}…`;
  });
  detail.persistence = persistence.note;

  // resume — مقتول أثناء EXECUTING ⇒ نفس نتيجة المتواصل (حالة + دليل + artifacts).
  const resume = check(() => {
    const repos = makeRepos();
    const continuous = new TaskEngine(repos);
    const refId = driveHappy(continuous, "gate-ref");
    const ref = continuous.getTask(refId)!;

    const killer = new TaskEngine(repos);
    const task = killer.createTask("gate-killed", SYSTEM);
    killer.understand(task.id, { brief: "gate" }, SYSTEM);
    killer.plan(
      task.id,
      [
        { id: "s1", operation: "collect", costCap: 0 },
        { id: "s2", operation: "summarize", costCap: 0 },
      ],
      SYSTEM,
    );
    killer.markReady(task.id, SYSTEM);
    killer.beginExecution(task.id, "s1", SYSTEM);
    { killer.observeStep(task.id, "s1", { ok: true }, SYSTEM); } // القتل هنا: إسقاط المحرك
    const revived = new TaskEngine(repos); // عملية جديدة، نفس المخزن
    const { context } = revived.resumeAfterKill(task.id, SYSTEM);
    if ((context as { stepId?: string }).stepId !== "s1") throw new Error("context not rebuilt");
    revived.verifyStep(
      task.id, "s1",
      { verdict: "verified", evidence: { step: "s1" }, artifact: { type: "note", ref: "s1" } },
      SYSTEM,
    );
    revived.beginExecution(task.id, "s2", SYSTEM);
    revived.observeStep(task.id, "s2", { ok: true }, SYSTEM);
    revived.verifyStep(
      task.id, "s2",
      { verdict: "verified", evidence: { step: "s2" }, artifact: { type: "note", ref: "s2" } },
      SYSTEM,
    );
    const done = revived.conclude(task.id, { alternativesAvailable: false }, SYSTEM);
    if (done.status !== ref.status) throw new Error("status diverged");
    if (done.evidenceChainHead !== ref.evidenceChainHead) throw new Error("evidence diverged");
    if (revived.artifacts(task.id).length !== continuous.artifacts(refId).length) {
      throw new Error("artifacts diverged");
    }
    return `resumed→${done.status} evidence=${done.evidenceChainHead.slice(0, 12)}…`;
  });
  detail.resume = resume.note;

  // approval — مدفوعة بلا منح ⇒ انتظار ⇒ اعتماد ⇒ COMPLETED · ورفض ⇒ BLOCKED.
  const approval = check(() => {
    const engine = new TaskEngine(makeRepos());
    const proposal = { operation: PAID_OPERATION, costCap: 50, args: { q: 1 } };
    const mk = (goal: string): string => {
      const t = engine.createTask(goal, SYSTEM);
      engine.understand(t.id, {}, SYSTEM);
      engine.plan(t.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], SYSTEM);
      engine.markReady(t.id, SYSTEM);
      return t.id;
    };
    const okId = mk("gate-approve");
    const { approval: apr } = engine.requestApproval(
      okId, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    if (engine.getTask(okId)!.status !== "WAITING_APPROVAL") throw new Error("no halt");
    engine.decideApproval(apr.id, { decision: "approved", by: HUMAN });
    engine.resume(okId, { approvalId: apr.id, operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM);
    engine.beginExecution(okId, "pay", SYSTEM);
    engine.observeStep(okId, "pay", { receipt: "r1" }, SYSTEM);
    engine.verifyStep(okId, "pay", { verdict: "verified", evidence: { paid: true } }, SYSTEM);
    const done = engine.conclude(okId, { alternativesAvailable: false }, SYSTEM);
    if (done.status !== "COMPLETED") throw new Error(`approve-path=${done.status}`);

    const noId = mk("gate-reject");
    const { approval: rej } = engine.requestApproval(
      noId, { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal }, SYSTEM,
    );
    const settled = engine.decideApproval(rej.id, { decision: "rejected", by: HUMAN });
    if (settled.task.status !== "BLOCKED") throw new Error(`reject-path=${settled.task.status}`);
    return "approve→COMPLETED reject→BLOCKED";
  });
  detail.approval = approval.note;

  // partial — تحقق جزئي بلا بدائل ⇒ PARTIAL أبدًا COMPLETED.
  const partial = check(() => {
    const engine = new TaskEngine(makeRepos());
    const t = engine.createTask("gate-partial", SYSTEM);
    engine.understand(t.id, {}, SYSTEM);
    engine.plan(
      t.id,
      [
        { id: "s1", operation: "collect", costCap: 0 },
        { id: "s2", operation: "collect", costCap: 0 },
      ],
      SYSTEM,
    );
    engine.markReady(t.id, SYSTEM);
    engine.beginExecution(t.id, "s1", SYSTEM);
    engine.observeStep(t.id, "s1", {}, SYSTEM);
    engine.verifyStep(t.id, "s1", { verdict: "verified", evidence: { ok: 1 } }, SYSTEM);
    engine.beginExecution(t.id, "s2", SYSTEM);
    engine.observeStep(t.id, "s2", {}, SYSTEM);
    engine.verifyStep(t.id, "s2", { verdict: "failed" }, SYSTEM);
    const done = engine.conclude(t.id, { alternativesAvailable: false }, SYSTEM);
    if (done.status !== "PARTIAL") throw new Error(`status=${done.status}`);
    return "PARTIAL (never COMPLETED)";
  });
  detail.partial = partial.note;

  // artifacts — من verified فقط، ومقروءة في PARTIAL.
  const artifacts = check(() => {
    const engine = new TaskEngine(makeRepos());
    const t = engine.createTask("gate-artifacts", SYSTEM);
    engine.understand(t.id, {}, SYSTEM);
    engine.plan(
      t.id,
      [
        { id: "good", operation: "collect", costCap: 0 },
        { id: "bad", operation: "collect", costCap: 0 },
      ],
      SYSTEM,
    );
    engine.markReady(t.id, SYSTEM);
    engine.beginExecution(t.id, "good", SYSTEM);
    engine.observeStep(t.id, "good", {}, SYSTEM);
    engine.verifyStep(
      t.id, "good",
      { verdict: "verified", evidence: { ok: 1 }, artifact: { type: "report", ref: "r-good" } },
      SYSTEM,
    );
    engine.beginExecution(t.id, "bad", SYSTEM);
    engine.observeStep(t.id, "bad", {}, SYSTEM);
    let refused = false;
    try {
      engine.verifyStep(
        t.id, "bad",
        { verdict: "failed", artifact: { type: "report", ref: "r-bad" } },
        SYSTEM,
      );
    } catch {
      refused = true;
    }
    if (!refused) throw new Error("failed-step artifact accepted");
    engine.verifyStep(t.id, "bad", { verdict: "failed" }, SYSTEM);
    const done = engine.conclude(t.id, { alternativesAvailable: false }, SYSTEM);
    const arts = engine.artifacts(t.id);
    if (done.status !== "PARTIAL" || arts.length !== 1 || arts[0].ref !== "r-good") {
      throw new Error("artifacts unreadable in PARTIAL");
    }
    return "1 artifact in PARTIAL, failed-step refused";
  });
  detail.artifacts = artifacts.note;

  const all = [runtime, persistence, resume, approval, partial, artifacts].every((c) => c.pass);
  return {
    runtime: all ? "PASS" : "FAIL",
    persistence_verified: persistence.pass,
    resume_verified: resume.pass,
    approval_flow_verified: approval.pass,
    partial_verified: partial.pass,
    artifacts_verified: artifacts.pass,
    detail,
  };
}

/** الصيغة القانونية للتقرير — ثلاثة أسطر كما في العقد §11. */
export function formatGen3Gate(result: Gen3GateResult, testsPass = "ci"): string {
  const b = (v: boolean): string => (v ? "true" : "false");
  return (
    `GEN3_GATE  runtime=${result.runtime} persistence_verified=${b(result.persistence_verified)} ` +
    `resume_verified=${b(result.resume_verified)}\n` +
    `           approval_flow_verified=${b(result.approval_flow_verified)} ` +
    `partial_verified=${b(result.partial_verified)}\n` +
    `           artifacts_verified=${b(result.artifacts_verified)} tests_pass=${testsPass}`
  );
}
