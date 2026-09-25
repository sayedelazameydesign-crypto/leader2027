import { describe, it, expect } from "vitest";
import {
  validateReportInput,
  isFieldReportStatus,
} from "@/lib/domain/field/field-report";
import { createReport } from "@/lib/domain/field/service";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";

const today = new Date().toISOString().slice(0, 10);

describe("field report validation", () => {
  it("يقبل تقريراً صحيحاً ويوحد القيم الافتراضية", () => {
    const r = validateReportInput({
      region_id: "region-giza",
      team_id: "team-a",
      report_date: today,
      activity: "حملة توعية",
      people_contacted: 12,
      volunteers_present: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.notes).toBe("");
      expect(r.value.people_contacted).toBe(12);
    }
  });

  it("يرفض غياب region_id/team_id", () => {
    const r = validateReportInput({ report_date: today, activity: "نشاط ميداني" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.region_id).toBeTruthy();
      expect(r.errors.team_id).toBeTruthy();
    }
  });

  it("يرفض تاريخاً بصيغة خاطئة أو في المستقبل", () => {
    const bad1 = validateReportInput({
      region_id: "r", team_id: "t", report_date: "01/02/2026", activity: "نشاط ميداني",
    });
    expect(bad1.ok).toBe(false);
    const bad2 = validateReportInput({
      region_id: "r", team_id: "t", report_date: "2099-01-01", activity: "نشاط ميداني",
    });
    expect(bad2.ok).toBe(false);
  });

  it("يرفض أعداداً سالبة أو غير صحيحة", () => {
    const r = validateReportInput({
      region_id: "r", team_id: "t", report_date: today, activity: "نشاط ميداني",
      people_contacted: -1, volunteers_present: 1.5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.people_contacted).toBeTruthy();
      expect(r.errors.volunteers_present).toBeTruthy();
    }
  });

  it("يرفض الحقول السياسية المحظورة (§5)", () => {
    const r = validateReportInput({
      region_id: "r", team_id: "t", report_date: today, activity: "نشاط ميداني",
      predicted_support: 40,
    });
    expect(r.ok).toBe(false);
  });

  it("isFieldReportStatus يفرّق الحالات", () => {
    expect(isFieldReportStatus("submitted")).toBe(true);
    expect(isFieldReportStatus("draft")).toBe(false);
  });
});

describe("field report — references must be valid (team/region) [AC7]", () => {
  const worker = { id: "user-worker", role: "FIELD_WORKER" as const, team_id: "team-a" };
  const base = {
    report_date: new Date().toISOString().slice(0, 10),
    activity: "نشاط ميداني",
  };

  it("team_id مجهول → 400", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createReport(worker, { ...base, region_id: "region-giza", team_id: "nope" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.errors.team_id).toBeTruthy();
    }
  });

  it("region_id مجهول → 400", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createReport(worker, { ...base, region_id: "nope", team_id: "team-a" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.region_id).toBeTruthy();
  });

  it("team/region صالحان → إنشاء مع reported_by ومصدر مسجَّل", () => {
    const repos = createMemoryRepos(seededStore());
    const r = createReport(worker, { ...base, region_id: "region-giza", team_id: "team-a" }, repos);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reported_by).toBe("user-worker");
      expect(r.value.status).toBe("submitted");
    }
  });
});
