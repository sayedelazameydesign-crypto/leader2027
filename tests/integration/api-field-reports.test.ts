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
