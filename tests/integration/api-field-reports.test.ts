import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { GET as listRoute, POST as createRoute } from "@/app/api/field/reports/route";
import {
  GET as getRoute,
  PATCH as patchRoute,
} from "@/app/api/field/reports/[id]/route";
import { GET as statsRoute } from "@/app/api/stats/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });
const today = new Date().toISOString().slice(0, 10);

function jsonReq(method: string, body: unknown, headers: Record<string, string>) {
  return new Request("http://test/api/field/reports", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  region_id: "region-giza",
  team_id: "team-a",
  report_date: today,
  activity: "حملة توعية",
  people_contacted: 7,
  volunteers_present: 2,
};

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

describe("api-field-reports: happy + invalid + authorization", () => {
  it("401 بلا جلسة (AC9)", async () => {
    const res = await listRoute(new Request("http://test/api/field/reports"));
    expect(res.status).toBe(401);
  });

  it("POST: Viewer → 403 — مرفوض (AC9)", async () => {
    const res = await createRoute(jsonReq("POST", validBody, cookieFor("user-viewer")));
    expect(res.status).toBe(403);
  });

  it("POST: Worker → 201 تقرير مُنشور (AC5) ويثبت ويُسترجع (AC6)", async () => {
    const res = await createRoute(jsonReq("POST", validBody, cookieFor("user-worker")));
    expect(res.status).toBe(201);
    const { report } = await res.json();
    expect(report.reported_by).toBe("user-worker");
    expect(report.status).toBe("submitted");

    const fetched = await getRoute(
      new Request("http://test/api/field/reports/x", { headers: cookieFor("user-worker") }),
      { params: Promise.resolve({ id: report.id }) },
    );
    expect(fetched.status).toBe(200);
    const data = await fetched.json();
    expect(data.report.people_contacted).toBe(7);
  });

  it("POST: team/region غير صالحين → 400 (AC7)", async () => {
    const badTeam = await createRoute(
      jsonReq("POST", { ...validBody, team_id: "nope" }, cookieFor("user-worker")),
    );
    expect(badTeam.status).toBe(400);
    const badRegion = await createRoute(
      jsonReq("POST", { ...validBody, region_id: "nope" }, cookieFor("user-worker")),
    );
    expect(badRegion.status).toBe(400);
  });

  it("POST: payload غير صالح → 400 (AC8)", async () => {
    const res = await createRoute(
      jsonReq("POST", { ...validBody, people_contacted: -3, activity: "أ" }, cookieFor("user-worker")),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors.people_contacted).toBeTruthy();
    expect(data.errors.activity).toBeTruthy();
  });

  it("PATCH: ملاحظات للمُنشئ فقط، والحالة للمنسق+ (تفسير 7)", async () => {
    const created = await createRoute(jsonReq("POST", validBody, cookieFor("user-worker")));
    const { report } = await created.json();

    const ownNotes = await patchRoute(
      jsonReq("PATCH", { notes: "ملاحظاتي" }, cookieFor("user-worker")),
      { params: Promise.resolve({ id: report.id }) },
    );
    expect(ownNotes.status).toBe(200);

    const foreign = await createRoute(
      jsonReq("POST", { ...validBody, team_id: "team-b", region_id: "region-haram" }, cookieFor("user-coordinator")),
    );
    const { report: other } = await foreign.json();
    const denied = await patchRoute(
      jsonReq("PATCH", { notes: "محاولة" }, cookieFor("user-worker")),
      { params: Promise.resolve({ id: other.id }) },
    );
    expect(denied.status).toBe(403);

    const workerStatus = await patchRoute(
      jsonReq("PATCH", { status: "closed" }, cookieFor("user-worker")),
      { params: Promise.resolve({ id: report.id }) },
    );
    expect(workerStatus.status).toBe(403);

    const coordStatus = await patchRoute(
      jsonReq("PATCH", { status: "under_review" }, cookieFor("user-coordinator")),
      { params: Promise.resolve({ id: report.id }) },
    );
    expect(coordStatus.status).toBe(200);
    expect(getRepos().reports.getById(report.id)?.status).toBe("under_review");
  });

  it("كل mutation أنشأ حدث تدقيق (AC10)", async () => {
    await createRoute(jsonReq("POST", validBody, cookieFor("user-worker")));
    await createRoute(jsonReq("POST", { ...validBody, people_contacted: 1 }, cookieFor("user-worker")));
    const events = getRepos().audit.list().filter((e) => e.action === "report.create");
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actor_id === "user-worker")).toBe(true);
  });

  it("stats تعكس النشاط المخزَّن — و401 بلا جلسة (AC11)", async () => {
    const anon = await statsRoute(new Request("http://test/api/stats"));
    expect(anon.status).toBe(401);

    const before = await statsRoute(
      new Request("http://test/api/stats", { headers: cookieFor("user-viewer") }),
    );
    const beforeData = await before.json();
    expect(beforeData.demo).toBe(false);

    await createRoute(jsonReq("POST", validBody, cookieFor("user-worker")));

    const after = await statsRoute(
      new Request("http://test/api/stats", { headers: cookieFor("user-viewer") }),
    );
    const afterData = await after.json();
    expect(afterData.kpis.reports).toBe(beforeData.kpis.reports + 1);
    expect(afterData.kpis.peopleContacted).toBe(beforeData.kpis.peopleContacted + 7);
    expect(afterData.kpis.volunteersPresent).toBe(beforeData.kpis.volunteersPresent + 2);
  });
});

/**
 * HTTP-level regression (PR #8) — إثبات السلسلة كاملة:
 * HTTP → route → مصادقة → سياسة → خدمة → مستودع → مخزن.
 *
 * اختبار الوحدة للسياسة وحده غير كافٍ: هذه الحالات تمرّ عبر الـroute الحقيقي
 * بجلسة حقيقية، وبيانات الملكية/الدور التالفة تُحقن في **مستوى المخزن**
 * (وهو الطريق الوحيد للوصولية — جسم الطلب لا يستطيع حقنها:
 * `reported_by` يُset خادميًا في service.ts:35 والدور مُتحقَّق بـisRole في
 * validation/users.ts:47,90).
 */
describe("api-field-reports: التفويض fail-closed مع بيانات تالفة (F-01a/F-01b)", () => {
  const patchNotes = (cookie: Record<string, string>, id: string, notes = "محاولة") =>
    patchRoute(jsonReq("PATCH", { notes }, cookie), { params: Promise.resolve({ id }) });

  it("F-01a: تقرير بلا reported_by في المخزن + FIELD_WORKER ⇒ 403 ولا كتابة", async () => {
    const store = seededStore();
    const victimId = store.reports[0].id;
    delete (store.reports[0] as { reported_by?: string }).reported_by;
    setRepos(createMemoryRepos(store));

    const res = await patchNotes(cookieFor("user-worker"), victimId, "استغلال غياب الملكية");
    expect(res.status).toBe(403);
    expect(getRepos().reports.getById(victimId)?.notes).not.toBe("استغلال غياب الملكية");
  });

  it("F-01a: reported_by تالف (null / رقم / نص فارغ) + FIELD_WORKER ⇒ 403", async () => {
    for (const bad of [null, 123, ""]) {
      const store = seededStore();
      const victimId = store.reports[0].id;
      (store.reports[0] as { reported_by?: unknown }).reported_by = bad;
      setRepos(createMemoryRepos(store));

      const res = await patchNotes(cookieFor("user-worker"), victimId);
      expect(res.status, `reported_by=${JSON.stringify(bad)}`).toBe(403);
    }
  });

  it("لا تغيير في دلالات الأدوار الأخرى: المنسّق يعدّل الملاحظات رغم غياب الملكية ⇒ 200", async () => {
    const store = seededStore();
    const victimId = store.reports[0].id;
    delete (store.reports[0] as { reported_by?: string }).reported_by;
    setRepos(createMemoryRepos(store));

    const res = await patchNotes(cookieFor("user-coordinator"), victimId, "مراجعة المنسق");
    expect(res.status).toBe(200);
    expect(getRepos().reports.getById(victimId)?.notes).toBe("مراجعة المنسق");
  });

  it("F-01b: مستخدم دوره اسم من Object.prototype ⇒ 403/قائمة فارغة، لا 500", async () => {
    const store = seededStore();
    const worker = store.users.find((u) => u.id === "user-worker");
    (worker as { role: string }).role = "toString";
    setRepos(createMemoryRepos(store));

    // الجلسة صالحة (التوقيع وepoch سليمين) لكن الدور تالف ⇒ منع افتراضي صريح
    const list = await listRoute(
      new Request("http://test/api/field/reports", { headers: cookieFor("user-worker") }),
    );
    expect(list.status).toBe(200);
    expect((await list.json()).reports).toEqual([]);

    const patch = await patchNotes(cookieFor("user-worker"), store.reports[0].id);
    expect(patch.status).toBe(403);

    const create = await createRoute(jsonReq("POST", validBody, cookieFor("user-worker")));
    expect(create.status).toBe(403);
  });

  it("دور غير معروف في المخزن (UNKNOWN) ⇒ كل الإجراءات ممنوعة عبر HTTP", async () => {
    const store = seededStore();
    (store.users.find((u) => u.id === "user-viewer") as { role: string }).role = "UNKNOWN";
    setRepos(createMemoryRepos(store));

    const list = await listRoute(
      new Request("http://test/api/field/reports", { headers: cookieFor("user-viewer") }),
    );
    expect(list.status).toBe(200);
    expect((await list.json()).reports).toEqual([]);
    expect((await patchNotes(cookieFor("user-viewer"), store.reports[0].id)).status).toBe(403);
  });

  it("VIEWER (دور غير مخوّل) يعدّل ملاحظات تقرير ⇒ 403", async () => {
    const store = seededStore();
    setRepos(createMemoryRepos(store));
    const res = await patchNotes(cookieFor("user-viewer"), store.reports[0].id, "غير مسموح");
    expect(res.status).toBe(403);
    expect(getRepos().reports.getById(store.reports[0].id)?.notes).not.toBe("غير مسموح");
  });

  it("لا تعديل عبر المستخدمين: عامل على تقرير عامل آخر ⇒ 403 (regression للعقد القائم)", async () => {
    const store = seededStore();
    setRepos(createMemoryRepos(store));
    // report-2 ملك user-coordinator
    const res = await patchNotes(cookieFor("user-worker"), "report-2", "تعديل عابر");
    expect(res.status).toBe(403);
    expect(getRepos().reports.getById("report-2")?.notes).not.toBe("تعديل عابر");
  });
});
