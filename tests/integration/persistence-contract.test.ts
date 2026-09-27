import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { createFileJsonRepos } from "@/lib/persistence/file-json";
import { createPostgresRepos } from "@/lib/persistence/postgres";
import { syncQuery } from "@/lib/persistence/sync-pg";
import type { Repos } from "@/lib/repositories/interfaces";
import type { Person } from "@/lib/domain/people/person";

const now = new Date().toISOString();

function makePerson(overrides: Partial<Omit<Person, "id">> = {}): Omit<Person, "id"> {
  return {
    full_name: "شخص اختبار",
    phone: null,
    region_id: null,
    source: "ميداني",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function contractSuite(name: string, factory: () => Repos) {
  describe(`persistence contract — ${name}`, () => {
    let repos: Repos;
    beforeEach(() => {
      repos = factory();
    });

    it("create", () => {
      const p = repos.people.create(makePerson());
      expect(p.id).toBeTruthy();
      expect(repos.people.getById(p.id)?.full_name).toBe("شخص اختبار");
    });

    it("read", () => {
      const p = repos.people.create(makePerson({ full_name: "قائم للقراءة" }));
      expect(repos.people.getById(p.id)?.full_name).toBe("قائم للقراءة");
      expect(repos.people.getById("missing")).toBeNull();
    });

    it("update", () => {
      const p = repos.people.create(makePerson());
      const updated = repos.people.update(p.id, { full_name: "اسم محدَّث" });
      expect(updated?.full_name).toBe("اسم محدَّث");
      expect(repos.people.getById(p.id)?.full_name).toBe("اسم محدَّث");
      expect(repos.people.update("missing", {})).toBeNull();
    });

    it("volunteers + reports + audit", () => {
      const person = repos.people.create(makePerson());
      const vol = repos.volunteers.create({
        person_id: person.id,
        team_id: "team-a",
        status: "active",
        joined_at: now,
        created_at: now,
        updated_at: now,
      });
      expect(repos.volunteers.getActiveByPerson(person.id)?.id).toBe(vol.id);

      const report = repos.reports.create({
        region_id: "region-giza",
        team_id: "team-a",
        reported_by: "user-worker",
        report_date: "2026-09-25",
        activity: "نشاط",
        people_contacted: 1,
        volunteers_present: 1,
        notes: "",
        status: "submitted",
        created_at: now,
        updated_at: now,
      });
      expect(repos.reports.list({ team_id: "team-a" })).toHaveLength(1);
      expect(repos.reports.getById(report.id)?.activity).toBe("نشاط");

      repos.audit.append({
        actor_id: "user-worker",
        actor_role: "FIELD_WORKER",
        action: "report.create",
        entity_type: "field_report",
        entity_id: report.id,
        at: now,
        meta: null,
      });
      expect(repos.audit.list()).toHaveLength(1);
    });

    it("GEN-3 tasks: create/read/update/list", () => {
      const task = repos.tasks.createTask({
        goal: "عقد التخزين",
        status: "CREATED",
        plan: [],
        checkpointHead: "",
        evidenceChainHead: "EVIDENCE-GENESIS",
        createdAt: now,
        updatedAt: now,
      });
      expect(task.id).toBeTruthy();
      expect(repos.tasks.getTask(task.id)?.goal).toBe("عقد التخزين");
      expect(repos.tasks.getTask("missing")).toBeNull();
      expect(repos.tasks.updateTask(task.id, { status: "READY" })?.status).toBe("READY");
      expect(repos.tasks.updateTask("missing", {})).toBeNull();
      expect(repos.tasks.listTasks()).toHaveLength(1);
    });

    it("GEN-3 tasks: checkpoints/approvals/grants/artifacts", () => {
      const task = repos.tasks.createTask({
        goal: "عقد الملحقات",
        status: "CREATED",
        plan: [],
        checkpointHead: "",
        evidenceChainHead: "EVIDENCE-GENESIS",
        createdAt: now,
        updatedAt: now,
      });
      const cp = repos.tasks.appendCheckpoint({
        taskId: task.id,
        seq: 0,
        state: "CREATED",
        stepId: null,
        context: {},
        prevHash: "GENESIS",
        hash: "h",
        evidenceHead: "E",
        at: now,
      });
      expect(cp.id).toBeTruthy();
      expect(repos.tasks.listCheckpoints(task.id)).toHaveLength(1);
      expect(repos.tasks.listCheckpoints("other")).toHaveLength(0);

      const approval = repos.tasks.createApproval({
        taskId: task.id,
        stepId: "s1",
        proposalHash: "p",
        operation: "op",
        costCap: 0,
        status: "pending",
        expiresAt: now,
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
      });
      expect(repos.tasks.getApproval(approval.id)?.status).toBe("pending");
      expect(repos.tasks.updateApproval(approval.id, { status: "approved" })?.status).toBe("approved");
      expect(repos.tasks.listApprovals(task.id)).toHaveLength(1);

      const grant = repos.tasks.createGrant({
        approvalId: approval.id,
        taskId: task.id,
        stepId: "s1",
        proposalHash: "p",
        operation: "op",
        costCap: 0,
        createdAt: now,
        consumedAt: null,
      });
      expect(repos.tasks.getGrantByApproval(approval.id)?.id).toBe(grant.id);
      expect(repos.tasks.updateGrant(grant.id, { consumedAt: now })?.consumedAt).toBe(now);
      expect(repos.tasks.listGrants(task.id)).toHaveLength(1);

      repos.tasks.createArtifact({
        taskId: task.id,
        stepId: "s1",
        type: "note",
        ref: "r",
        evidenceHash: "e",
        createdAt: now,
      });
      expect(repos.tasks.listArtifacts(task.id)).toHaveLength(1);
    });

    it("GEN-4 leases: create/read/update/list + heartbeats", () => {
      const task = repos.tasks.createTask({
        goal: "عقد الإيجار",
        status: "READY",
        plan: [],
        checkpointHead: "",
        evidenceChainHead: "EVIDENCE-GENESIS",
        createdAt: now,
        updatedAt: now,
      });
      const lease = repos.tasks.createLease({
        taskId: task.id,
        workerId: "worker-a",
        fencingToken: 1,
        acquiredAt: now,
        expiresAt: now,
        lastHeartbeatAt: now,
        releasedAt: null,
      });
      expect(lease.id).toBeTruthy();
      expect(repos.tasks.getLease(lease.id)?.workerId).toBe("worker-a");
      expect(repos.tasks.getLease("missing")).toBeNull();
      expect(repos.tasks.updateLease(lease.id, { releasedAt: now })?.releasedAt).toBe(now);
      expect(repos.tasks.listLeases(task.id)).toHaveLength(1);
      expect(repos.tasks.listLeases("other")).toHaveLength(0);

      const hb = repos.tasks.recordHeartbeat({
        leaseId: lease.id,
        taskId: task.id,
        workerId: "worker-a",
        at: now,
      });
      expect(hb.id).toBeTruthy();
      expect(repos.tasks.listHeartbeats(lease.id)).toHaveLength(1);
      expect(repos.tasks.listHeartbeats("other")).toHaveLength(0);
    });

    it("GEN-4 attempts: record/find/list (مفتاح idempotency مستقر)", () => {
      const attempt = repos.tasks.recordAttempt({
        taskId: "t1",
        stepId: "pay",
        proposalHash: "p",
        attemptToken: "tok-1",
        fencingToken: 1,
        status: "executed",
        evidenceHash: "e",
        result: { receipt: "r" },
        recordedAt: now,
      });
      expect(attempt.id).toBeTruthy();
      expect(repos.tasks.findAttempt("t1", "pay", "p")?.attemptToken).toBe("tok-1");
      expect(repos.tasks.findAttempt("t1", "pay", "other")).toBeNull();
      expect(repos.tasks.listAttempts("t1")).toHaveLength(1);
      expect(repos.tasks.listAttempts("t2")).toHaveLength(0);
    });
  });
}

contractSuite("InMemory", () => createMemoryRepos());

describe("persistence contract — FileJson (durable across reopen)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "l27-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  contractSuite("FileJson", () => createFileJsonRepos(path.join(dir, `db-${Math.random()}.json`), false));

  it("create/read/update يصمدان عبر إغلاق وإعادة فتح الملف", () => {
    const file = path.join(dir, "durable.json");
    const first = createFileJsonRepos(file, false);
    const p = first.people.create(makePerson({ full_name: "مستدام" }));

    const second = createFileJsonRepos(file, false);
    expect(second.people.getById(p.id)?.full_name).toBe("مستدام");
    second.people.update(p.id, { full_name: "مستدام 2" });

    const third = createFileJsonRepos(file, false);
    expect(third.people.getById(p.id)?.full_name).toBe("مستدام 2");
    expect(existsSync(file)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VS5/T1 — المحوّل الحيّ ضد Postgres (يُشغَّل عند توفّر L27_TEST_DATABASE_URL).
// نفس العقد حرفيًا: create/read/update/volunteers+reports+audit + استمرارية + بذر.
// ---------------------------------------------------------------------------

const pgUrl = process.env.L27_TEST_DATABASE_URL;

describe.skipIf(!pgUrl)("persistence contract — PostgreSQL (حيّ)", () => {
  beforeAll(() => {
    createPostgresRepos(pgUrl!, false); // يضمن وجود المخطط
    syncQuery("DELETE FROM l27_store", [], pgUrl!);
  });

  contractSuite("PostgreSQL", () => {
    syncQuery("DELETE FROM l27_store", [], pgUrl!);
    return createPostgresRepos(pgUrl!, false);
  });

  it("الاستمرارية عبر إعادة إنشاء المحول (read-after-write على القرص المشترك)", () => {
    syncQuery("DELETE FROM l27_store", [], pgUrl!);
    const first = createPostgresRepos(pgUrl!, false);
    const p = first.people.create(makePerson({ full_name: "مستدام-pg" }));

    const second = createPostgresRepos(pgUrl!, false);
    expect(second.people.getById(p.id)?.full_name).toBe("مستدام-pg");
    second.people.update(p.id, { full_name: "مستدام-pg-2" });

    const third = createPostgresRepos(pgUrl!, false);
    expect(third.people.getById(p.id)?.full_name).toBe("مستدام-pg-2");
  });

  it("البذر على قاعدة فارغة — مرة واحدة فقط (seedIfEmpty)", () => {
    syncQuery("DELETE FROM l27_store", [], pgUrl!);
    const seeded = createPostgresRepos(pgUrl!, true);
    expect(seeded.users.list().length).toBeGreaterThan(0);
    const reopened = createPostgresRepos(pgUrl!, true);
    expect(reopened.users.list()).toHaveLength(seeded.users.list().length);
    expect(reopened.campaign.get()?.name).toBe("حملة Leader 2027");
  });
});
