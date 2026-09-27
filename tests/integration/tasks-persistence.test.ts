/**
 * GEN-3 — استمرارية المهام عبر إعادة التشغيل (file Round-trip حقيقي).
 *
 * يحاكي قتل العملية: مقبض جديد لنفس الملف ⇒ نفس الحالة + سلسلة سليمة + إكمال.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileJsonRepos } from "@/lib/persistence/file-json";
import { TaskEngine } from "@/lib/tasks/engine";
import { formatGen3Gate, runGen3SelfChecks } from "@/lib/tasks/gate";
import type { TaskActor } from "@/lib/tasks/types";

const SYSTEM: TaskActor = { id: "test", kind: "system" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "l27-gen3-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tasks-persistence: القتل وإعادة الفتح (file)", () => {
  it("EXECUTING تصمد عبر إغلاق وإعادة فتح — ثم تُستأنَف وتُكمَل", () => {
    const file = path.join(dir, "tasks.json");

    // العملية الأولى: تقدُّم حتى قلب التنفيذ
    const first = new TaskEngine(createFileJsonRepos(file, false));
    const task = first.createTask("مستدامة", SYSTEM);
    first.understand(task.id, { brief: "b" }, SYSTEM);
    first.plan(
      task.id,
      [
        { id: "s1", operation: "collect", costCap: 0 },
        { id: "s2", operation: "summarize", costCap: 0 },
      ],
      SYSTEM,
    );
    first.markReady(task.id, SYSTEM);
    first.beginExecution(task.id, "s1", SYSTEM);
    const headBefore = first.getTask(task.id)!.checkpointHead;

    // القتل: مقبض جديد تمامًا لنفس الملف (عملية جديدة)
    const second = new TaskEngine(createFileJsonRepos(file, false));
    const reloaded = second.getTask(task.id);
    expect(reloaded?.status).toBe("EXECUTING");
    expect(reloaded?.checkpointHead).toBe(headBefore);
    expect(reloaded?.plan).toHaveLength(2);
    expect(second.verifyChain(task.id)).toBe(true);

    const resumed = second.resumeAfterKill(task.id, SYSTEM);
    expect(resumed.task.status).toBe("EXECUTING");
    expect(resumed.context).toMatchObject({ stepId: "s1" });

    // الإكمال على المقبض الجديد
    second.observeStep(task.id, "s1", { ok: true }, SYSTEM);
    second.verifyStep(task.id, "s1", { verdict: "verified", evidence: { step: "s1" } }, SYSTEM);
    second.beginExecution(task.id, "s2", SYSTEM);
    second.observeStep(task.id, "s2", { ok: true }, SYSTEM);
    second.verifyStep(task.id, "s2", { verdict: "verified", evidence: { step: "s2" } }, SYSTEM);
    const done = second.conclude(task.id, { alternativesAvailable: false }, SYSTEM);
    expect(done.status).toBe("COMPLETED");

    // مقبض ثالث يرى النهاية (ديمومة كاملة)
    const third = new TaskEngine(createFileJsonRepos(file, false));
    expect(third.getTask(task.id)?.status).toBe("COMPLETED");
    expect(third.verifyChain(task.id)).toBe(true);
    expect(third.artifacts(task.id)).toHaveLength(0);
  });

  it("الموافقة المعلَّقة تصمد عبر إعادة الفتح — اعتماد ثم استئناف", () => {
    const file = path.join(dir, "approval.json");
    const proposal = { operation: "NEXA_A_PAID", costCap: 5 };
    const first = new TaskEngine(createFileJsonRepos(file, false));
    const task = first.createTask("معلَّقة", SYSTEM);
    first.understand(task.id, {}, SYSTEM);
    first.plan(task.id, [{ id: "pay", operation: "NEXA_A_PAID", costCap: 5 }], SYSTEM);
    first.markReady(task.id, SYSTEM);
    const { approval } = first.requestApproval(
      task.id,
      { stepId: "pay", operation: "NEXA_A_PAID", costCap: 5, proposal },
      SYSTEM,
    );

    const second = new TaskEngine(createFileJsonRepos(file, false));
    expect(second.getTask(task.id)?.status).toBe("WAITING_APPROVAL");
    expect(second.approvals(task.id)).toHaveLength(1);
    const decided = second.decideApproval(approval.id, {
      decision: "approved",
      by: { id: "user-manager", kind: "human", role: "CAMPAIGN_MANAGER" },
    });
    expect(decided.grant).not.toBeNull();

    const third = new TaskEngine(createFileJsonRepos(file, false));
    const resumed = third.resume(
      task.id,
      { approvalId: approval.id, operation: "NEXA_A_PAID", costCap: 5, proposal },
      SYSTEM,
    );
    expect(resumed.status).toBe("READY");
  });

  it("توافق قدماء: ملف قديم بلا مفاتيح tasks ⇒ يعمل والتوسيع بإضافة", () => {
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
      }),
      "utf-8",
    );
    const engine = new TaskEngine(createFileJsonRepos(file, false));
    const task = engine.createTask("على ملف قديم", SYSTEM);
    expect(engine.getTask(task.id)?.status).toBe("CREATED");
    expect(engine.listTasks()).toHaveLength(1);
    // وإعادة الفتح تحفظها (كُتبت المفاتيح الجديدة في الملف)
    const reopened = new TaskEngine(createFileJsonRepos(file, false));
    expect(reopened.getTask(task.id)?.goal).toBe("على ملف قديم");
  });

  it("GEN3_GATE كاملة خضراء ضد ملف حقيقي (إعادة فتح فعلية)", () => {
    const file = path.join(dir, "gate.json");
    const result = runGen3SelfChecks(() => createFileJsonRepos(file, false));
    expect(result).toMatchObject({
      runtime: "PASS",
      persistence_verified: true,
      resume_verified: true,
      approval_flow_verified: true,
      partial_verified: true,
      artifacts_verified: true,
    });
    const text = formatGen3Gate(result);
    expect(text).toContain("runtime=PASS");
    expect(text).toContain("tests_pass=ci");
  });
});
