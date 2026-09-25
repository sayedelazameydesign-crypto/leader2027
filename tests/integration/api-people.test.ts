import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { GET as listRoute, POST as createRoute } from "@/app/api/people/route";
import {
  GET as getRoute,
  PATCH as patchRoute,
} from "@/app/api/people/[id]/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function jsonReq(method: string, body: unknown, headers: Record<string, string>) {
  return new Request("http://test/api/people", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

describe("api-people: happy + invalid + authorization", () => {
  it("401 بلا جلسة (AC9)", async () => {
    const res = await listRoute(new Request("http://test/api/people"));
    expect(res.status).toBe(401);
  });

  it("GET: Viewer يقرأ القائمة (محدود = قراءة)", async () => {
    const res = await listRoute(
      new Request("http://test/api/people", { headers: cookieFor("user-viewer") }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.people).toHaveLength(3);
  });

  it("POST: Viewer → 403 (AC9) ولا يُنشأ شيء", async () => {
    const res = await createRoute(
      jsonReq("POST", { full_name: "اسم طويل", source: "ميداني" }, cookieFor("user-viewer")),
    );
    expect(res.status).toBe(403);
  });

  it("POST: Coordinator → 201 ويُخزَّن (read-after-write AC3)", async () => {
    const res = await createRoute(
      jsonReq("POST", { full_name: "شخص جديد", phone: "01011112222", source: "ميداني", region_id: "region-giza" }, cookieFor("user-coordinator")),
    );
    expect(res.status).toBe(201);
    const { person } = await res.json();

    const fetched = await getRoute(
      new Request("http://test/api/people/x", { headers: cookieFor("user-viewer") }),
      { params: Promise.resolve({ id: person.id }) },
    );
    expect(fetched.status).toBe(200);
    const data = await fetched.json();
    expect(data.person.full_name).toBe("شخص جديد");
  });

  it("POST: payload غير صالح → 400 (AC8)", async () => {
    const res = await createRoute(jsonReq("POST", { full_name: "", source: "" }, cookieFor("user-coordinator")));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors.full_name).toBeTruthy();
    expect(data.errors.source).toBeTruthy();
  });

  it("POST: حقل سياسي محظور → 400 (§5)", async () => {
    const res = await createRoute(
      jsonReq("POST", { full_name: "اسم طويل", source: "ميداني", political_score: 10 }, cookieFor("user-coordinator")),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors.political_score).toContain("محظور");
  });

  it("GET [id]: 404 لغير الموجود", async () => {
    const res = await getRoute(new Request("http://test/api/people/x", { headers: cookieFor("user-viewer") }), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH: Worker → 403، Coordinator → 200 (AC9)", async () => {
    const denied = await patchRoute(
      jsonReq("PATCH", { full_name: "اسم محدَّث" }, cookieFor("user-worker")),
      { params: Promise.resolve({ id: "person-1" }) },
    );
    expect(denied.status).toBe(403);

    const allowed = await patchRoute(
      jsonReq("PATCH", { full_name: "اسم محدَّث" }, cookieFor("user-coordinator")),
      { params: Promise.resolve({ id: "person-1" }) },
    );
    expect(allowed.status).toBe(200);
    const data = await allowed.json();
    expect(data.person.full_name).toBe("اسم محدَّث");
  });
});
