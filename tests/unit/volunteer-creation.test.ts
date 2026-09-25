import { describe, it, expect } from "vitest";
import {
  validateVolunteerInput,
  validateVolunteerPatch,
} from "@/lib/domain/volunteers/volunteer";
import { createVolunteer } from "@/lib/domain/volunteers/service";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";

describe("volunteer creation — validation", () => {
  it("يقبل مدخلاً صحيحاً مع حالة افتراضية", () => {
    const r = validateVolunteerInput({ person_id: "p1", team_id: "team-a" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("active");
  });

  it("يرفض person_id أو team_id فارغاً", () => {
    const r = validateVolunteerInput({ person_id: "", team_id: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.person_id).toBeTruthy();
      expect(r.errors.team_id).toBeTruthy();
    }
  });

  it("يرفض حالة غير معروفة", () => {
    const r = validateVolunteerInput({
      person_id: "p1",
      team_id: "t1",
      status: "busy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.status).toBeTruthy();
  });

  it("يرفض الحقول السياسية المحظورة (§5)", () => {
    const r = validateVolunteerInput({
      person_id: "p1",
      team_id: "t1",
      persuadability_score: 9,
    });
    expect(r.ok).toBe(false);
  });

  it("validateVolunteerPatch يعمل على الحالة وحدها", () => {
    const r = validateVolunteerPatch({ status: "inactive" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("inactive");
  });
});

describe("volunteer creation — service rules (person exists / team valid / dedup)", () => {
  const coordinator = { id: "user-coordinator", role: "FIELD_COORDINATOR" as const, team_id: "team-a" };
  const worker = { id: "user-worker", role: "FIELD_WORKER" as const, team_id: "team-a" };

  it("يرفض person_id غير موجود", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createVolunteer(coordinator, { person_id: "nope", team_id: "team-a" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.errors.person_id).toBeTruthy();
    }
  });

  it("يرفض team_id غير موجود", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createVolunteer(coordinator, { person_id: "person-3", team_id: "nope" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.team_id).toBeTruthy();
  });

  it("يمنع تكرار المتطوع النشط (409)", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createVolunteer(coordinator, { person_id: "person-1", team_id: "team-b" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("ينشئ متطوعاً صالحاً ويسجل التدقيق", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createVolunteer(coordinator, { person_id: "person-3", team_id: "team-a" }, repos);
    expect(r.ok).toBe(true);
    const event = repos.audit.list().find((e) => e.action === "volunteer.create");
    expect(event?.actor_id).toBe("user-coordinator");
  });

  it("يرفض الإنشاء من غير المُصرَّح (403)", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createVolunteer(worker, { person_id: "person-3", team_id: "team-a" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});
