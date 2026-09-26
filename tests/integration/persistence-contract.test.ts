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
