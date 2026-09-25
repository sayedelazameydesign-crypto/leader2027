import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import type { Repos } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/authorization/policy";
import { createVolunteer } from "@/lib/domain/volunteers/service";
import { createReport, updateReport } from "@/lib/domain/field/service";
import { getKpis } from "@/lib/domain/dashboard";

const coordinator: Actor = { id: "user-coordinator", role: "FIELD_COORDINATOR", team_id: "team-a" };
const worker: Actor = { id: "user-worker", role: "FIELD_WORKER", team_id: "team-a" };
const viewer: Actor = { id: "user-viewer", role: "VIEWER", team_id: null };

let repos: Repos;

beforeEach(() => {
  repos = createMemoryRepos(seededStore());
  setRepos(repos);
});

afterEach(() => {
  setRepos(null);
});

describe("flow: volunteer → field report → stats + audit", () => {
  it("التدفق الكامل ينعكس على المؤشرات ويسجل التدقيق", () => {
    const before = getKpis(coordinator, getRepos());
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value).toEqual({
      people: 3,
      volunteers: 2,
      reports: 2,
      peopleContacted: 15,
      volunteersPresent: 5,
    });

    // 1) منسق يسجّل متطوعاً لشخص موجود بلا متطوع نشط
    const vol = createVolunteer(
      coordinator,
      { person_id: "person-3", team_id: "team-a" },
      repos,
    );
    expect(vol.ok).toBe(true);

    // 2) عامل ميداني ينشئ تقريراً ميدانياً
    const report = createReport(
      worker,
      {
        region_id: "region-giza",
        team_id: "team-a",
        report_date: new Date().toISOString().slice(0, 10),
        activity: "حملة توعية",
        people_contacted: 7,
        volunteers_present: 2,
      },
      repos,
    );
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.reported_by).toBe("user-worker");

    // 3) المؤشرات تعكس النشاط المخزَّن (لا demo)
    const after = getKpis(coordinator, repos);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.volunteers).toBe(3);
      expect(after.value.reports).toBe(3);
      expect(after.value.peopleContacted).toBe(22);
      expect(after.value.volunteersPresent).toBe(7);
    }

    // 4) كل mutation أنشأ حدث تدقيق بفاعل وفعل صحيحين
    const events = repos.audit.list();
    const userEvents = events.filter((e) => e.action !== "system.seed");
    expect(userEvents).toHaveLength(2);
    const volEvent = userEvents.find((e) => e.action === "volunteer.create");
    expect(volEvent?.actor_id).toBe("user-coordinator");
    expect(volEvent?.entity_type).toBe("volunteer");
    const repEvent = userEvents.find((e) => e.action === "report.create");
    expect(repEvent?.actor_id).toBe("user-worker");
    expect(repEvent?.entity_type).toBe("field_report");
  });

  it("منع التكرار: متطوع نشط ثانٍ لنفس الشخص → 409", () => {
    const r = createVolunteer(coordinator, { person_id: "person-1", team_id: "team-b" }, repos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("شخص أو فريق غير موجود → 400 (مرجعية غير صالحة)", () => {
    const bad1 = createVolunteer(coordinator, { person_id: "nope", team_id: "team-a" }, repos);
    expect(bad1.ok).toBe(false);
    if (!bad1.ok) {
      expect(bad1.status).toBe(400);
      expect(bad1.errors.person_id).toBeTruthy();
    }
    const bad2 = createVolunteer(coordinator, { person_id: "person-3", team_id: "nope" }, repos);
    expect(bad2.ok).toBe(false);
    if (!bad2.ok) expect(bad2.errors.team_id).toBeTruthy();

    const bad3 = createReport(worker, {
      region_id: "nope", team_id: "team-a",
      report_date: "2026-09-25", activity: "نشاط ميداني",
    }, repos);
    expect(bad3.ok).toBe(false);
    if (!bad3.ok) expect(bad3.errors.region_id).toBeTruthy();
  });

  it("صلاحيات على مستوى الخدمة: Viewer يُمنع من الإنشاء، Worker يُمنع من تعيين متطوع", () => {
    const v = createReport(viewer, {
      region_id: "region-giza", team_id: "team-a",
      report_date: "2026-09-25", activity: "نشاط ميداني",
    }, repos);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(403);

    const w = createVolunteer(worker, { person_id: "person-3", team_id: "team-a" }, repos);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.status).toBe(403);
  });

  it("PATCH: عامل يعدّل ملاحظات تقريره وحده، وتغيير الحالة للمنسق فقط", () => {
    const created = createReport(worker, {
      region_id: "region-giza", team_id: "team-a",
      report_date: "2026-09-25", activity: "نشاط ميداني",
    }, repos);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    // عامل على تقرير غير له → 403
    const foreign = createReport(
      { id: "user-other", role: "FIELD_WORKER", team_id: "team-b" },
      { region_id: "region-haram", team_id: "team-b", report_date: "2026-09-25", activity: "نشاط آخر" },
      repos,
    );
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    const editForeign = updateReport(worker, foreign.value.id, { notes: "محاولة" }, repos);
    expect(editForeign.ok).toBe(false);
    if (!editForeign.ok) expect(editForeign.status).toBe(403);

    // صاحب التقرير يعدّل ملاحظاته
    const editOwn = updateReport(worker, id, { notes: "ملاحظات محدَّثة" }, repos);
    expect(editOwn.ok).toBe(true);

    // محاولة تعديل حقل ممنوع
    const forbiddenField = updateReport(worker, id, { activity: "إعادة كتابة" }, repos);
    expect(forbiddenField.ok).toBe(false);
    if (!forbiddenField.ok) expect(forbiddenField.errors.activity).toBeTruthy();

    // حالة: Worker ممنوع، Coordinator ينجح
    const workerStatus = updateReport(worker, id, { status: "under_review" }, repos);
    expect(workerStatus.ok).toBe(false);
    if (!workerStatus.ok) expect(workerStatus.status).toBe(403);

    const coordStatus = updateReport(coordinator, id, { status: "under_review" }, repos);
    expect(coordStatus.ok).toBe(true);
    if (coordStatus.ok) expect(coordStatus.value.status).toBe("under_review");

    // التدقيق سجّل التحديثات المقبولة وحدها (المرفوضة ليست mutations)
    const updates = repos.audit.list().filter((e) => e.action === "report.update");
    expect(updates.length).toBe(2);
  });
});
