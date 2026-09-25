import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { createFileJsonRepos } from "@/lib/persistence/file-json";
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
