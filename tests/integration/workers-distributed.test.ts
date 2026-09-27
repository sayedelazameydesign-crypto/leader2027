/**
 * GEN-4 — التنسيق عبر العمليات: مقبضان مستقلان (workers) على نفس الملف.
 *
 * يثبت أن صفوف الـLease في `Store` هي المصدر الوحيد — لا ذاكرة مشتركة.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileJsonRepos } from "@/lib/persistence/file-json";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { PAID_OPERATION, type TaskActor } from "@/lib/tasks/types";
import { ExecutionCoordinator } from "@/lib/workers/coordinator";
import { formatGen4Gate, runGen4SelfChecks } from "@/lib/workers/gate";

const T0 = Date.parse("2026-09-27T00:00:00.000Z");
const HUMAN: TaskActor = { id: "user-manager", kind: "human", role: "CAMPAIGN_MANAGER" };
const SYSTEM: TaskActor = { id: "test", kind: "system" };
const TTL = 30_000;
const MARGIN = 5_000;

let dir: string;
let t: number;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "l27-gen4-"));
  t = T0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** عاملان بساعتين مستقلتين ظاهريًا (متزامنتان هنا) على نفس الملف. */
function twoWorkers(file: string): [ExecutionCoordinator, ExecutionCoordinator] {
  const mk = (): ExecutionCoordinator =>
    new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
  return [mk(), mk()];
}

function toReady(coord: ExecutionCoordinator, goal: string): string {
  const engine = coord.engine;
  const task = engine.createTask(goal, SYSTEM);
  engine.understand(task.id, { brief: "d" }, SYSTEM);
  engine.plan(
    task.id,
    [
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

function paidTask(coord: ExecutionCoordinator, goal: string): string {
  const engine = coord.engine;
  const task = engine.createTask(goal, SYSTEM);
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
  approvePaid(coord, task.id);
  return task.id;
}

function freshCoord(file: string): ExecutionCoordinator {
  return new ExecutionCoordinator(createFileJsonRepos(file, false), {
    now: () => t,
    leaseTtlMs: TTL,
    heartbeatMarginMs: MARGIN,
  });
}

describe("workers-distributed: مقبضان على ملف واحد", () => {
  it("A يطالب عبر مقبضه ⇒ B مرفوض عبر مقبضه · وبعد التسليم B يفوز بحقبة أعلى", () => {
    const file = path.join(dir, "leases.json");
    const [a, b] = twoWorkers(file);
    const id = toReady(a, "مقبضان");

    // B يرى المهمة عبر مقبضه (قراءة طازجة من الملف)
    const freshB = new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    expect(freshB.engine.getTask(id)?.status).toBe("READY");

    const won = a.claim(id, "worker-a");
    expect(won.status).toBe("claimed");
    // B بمقبض جديد تمامًا (عملية أخرى) ⇒ مرفوض
    const rival = new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    expect(rival.claim(id, "worker-b").status).toBe("denied");

    expect(a.release(id, "worker-a").status).toBe("released");
    // مقبض جديد بعد التسليم (الإنتاج: getRepos طازج لكل عملية)
    const heir = new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    const take = heir.claim(id, "worker-b");
    expect(take.status).toBe("claimed");
    if (take.status === "claimed" && won.status === "claimed") {
      expect(take.lease.fencingToken).toBe(won.lease.fencingToken + 1);
    }
    void b;
  });

  it("موت A ⇒ استرداد B عبر مقبضه ⇒ نفس دليل المرجع", () => {
    const file = path.join(dir, "reclaim.json");
    // المرجع: ذاكرة متواصلة
    let rt = T0;
    const ref = new ExecutionCoordinator(createMemoryRepos(), {
      now: () => rt,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    const refId = toReady(ref, "مرجع");
    expect(ref.claim(refId, "worker-ref").status).toBe("claimed");
    for (const stepId of ["s1", "s2"]) {
      const out = ref.executeStep(refId, "worker-ref", stepId, {
        verdict: "verified",
        observation: { step: stepId },
        evidence: { step: stepId },
      });
      expect(out.status).toBe("ok");
    }
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    // المقتول على الملف
    const [a] = twoWorkers(file);
    const id = toReady(a, "موت موزع");
    expect(a.claim(id, "worker-a").status).toBe("claimed");
    const s1 = a.executeStep(id, "worker-a", "s1", {
      verdict: "verified",
      observation: { step: "s1" },
      evidence: { step: "s1" },
    });
    expect(s1.status).toBe("ok");
    t += TTL + 1; // الموت

    // الوريث بمقبض جديد (عملية جديدة)
    const heir = new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    const c2 = heir.claim(id, "worker-b");
    expect(c2.status).toBe("claimed");
    if (c2.status === "claimed") expect(c2.reclaimed).toBe(true);
    const s2 = heir.executeStep(id, "worker-b", "s2", {
      verdict: "verified",
      observation: { step: "s2" },
      evidence: { step: "s2" },
    });
    expect(s2.status).toBe("ok");
    const done = heir.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe(refDone.status);
    expect(done.evidenceChainHead).toBe(refDone.evidenceChainHead);
  });

  it("فعل مدفوع على الملف: موت→استرداد ⇒ النداء مرة واحدة + نفس دليل المرجع", () => {
    const file = path.join(dir, "paid.json");
    const refFile = path.join(dir, "paid-ref.json");

    // المرجع: تشغيل متواصل على ملف مستقل بنفس الإيصال
    let refCalls = 0;
    const ref = freshCoord(refFile);
    const refId = paidTask(ref, "مرجع مدفوع");
    expect(ref.claim(refId, "worker-ref").status).toBe("claimed");
    const refPay = ref.executeStep(refId, "worker-ref", "pay", {
      verdict: "verified",
      call: () => {
        refCalls += 1;
        return { receipt: "r-1" };
      },
    });
    expect(refPay.status).toBe("ok");
    const refS2 = ref.executeStep(refId, "worker-ref", "s2", {
      verdict: "verified",
      observation: { step: "s2" },
      evidence: { step: "s2" },
    });
    expect(refS2.status).toBe("ok");
    const refDone = ref.engine.conclude(refId, { alternativesAvailable: false }, SYSTEM);

    // المقتول: خطوة مدفوعة كاملة ثم موت (مقبض مستقل على ملف مستقل)
    let calls = 0;
    const call = (): unknown => {
      calls += 1;
      return { receipt: "r-1" };
    };
    const a = freshCoord(file);
    const id = paidTask(a, "موت مدفوع");
    expect(a.claim(id, "worker-a").status).toBe("claimed");
    const first = a.executeStep(id, "worker-a", "pay", { verdict: "verified", call });
    expect(first.status).toBe("ok");
    t += TTL + 1; // الموت: لا نبض ولا تسليم

    // الوريث بمقبض جديد تمامًا (عملية أخرى متسلسلة)
    const heir = freshCoord(file);
    const c2 = heir.claim(id, "worker-b");
    expect(c2.status).toBe("claimed");
    if (c2.status === "claimed") expect(c2.reclaimed).toBe(true);
    // إعادة الخطوة المدفوعة ⇒ تخطي من السجل بلا نداء (exactly-once على الملف)
    const retry = heir.executeStep(id, "worker-b", "pay", { verdict: "verified", call });
    expect(retry.status).toBe("already-verified");
    expect(calls).toBe(1);
    const s2 = heir.executeStep(id, "worker-b", "s2", {
      verdict: "verified",
      observation: { step: "s2" },
      evidence: { step: "s2" },
    });
    expect(s2.status).toBe("ok");
    const done = heir.engine.conclude(id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");
    expect(done.status).toBe(refDone.status);
    expect(done.evidenceChainHead).toBe(refDone.evidenceChainHead);
    expect(heir.engine.verifyChain(id)).toBe(true);
    expect(refCalls).toBe(1);
  });

  it("توافق قدماء: ملف بلا مفاتيح GEN-4 ⇒ المطالبة تعمل", () => {
    const file = path.join(dir, "legacy.json");
    writeFileSync(
      file,
      JSON.stringify({
        people: [],
        volunteers: [],
        reports: [],
        users: [],
        regions: [],
        teams: [],
        campaign: null,
        cycles: [],
        audit: [],
        tasks: [],
        taskCheckpoints: [],
        taskApprovals: [],
        taskGrants: [],
        taskArtifacts: [],
      }),
      "utf-8",
    );
    const coord = new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    const id = toReady(coord, "قديم", );
    expect(coord.claim(id, "worker-a").status).toBe("claimed");
    const reopened = new ExecutionCoordinator(createFileJsonRepos(file, false), {
      now: () => t,
      leaseTtlMs: TTL,
      heartbeatMarginMs: MARGIN,
    });
    expect(reopened.claim(id, "worker-b").status).toBe("denied");
  });

  it("GEN4_GATE كاملة خضراء ضد ملف حقيقي (إعادة فتح فعلية)", () => {
    const file = path.join(dir, "gate.json");
    const result = runGen4SelfChecks(() => createFileJsonRepos(file, false));
    expect(result).toMatchObject({
      runtime: "PASS",
      lease_exclusivity_verified: true,
      fencing_verified: true,
      reclaim_replay_verified: true,
      exactly_once_verified: true,
      batch_crash_recovery_verified: true,
    });
    expect(formatGen4Gate(result)).toContain("tests_pass=ci");
  });
});
