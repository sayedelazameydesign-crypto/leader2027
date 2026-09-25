import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { GET as listRoute, POST as createRoute } from "@/app/api/volunteers/route";
import {
  GET as getRoute,
  PATCH as patchRoute,
} from "@/app/api/volunteers/[id]/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function jsonReq(method: string, body: unknown, headers: Record<string, string>) {
  return new Request("http://test/api/volunteers", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

describe("api-volunteers: happy + invalid + authorization", () => {
  it("401 بلا جلسة (AC9)", async () => {
    const res = await listRoute(new Request("http://test/api/volunteers"));
    expect(res.status).toBe(401);
  });

  it("POST: Worker → 403 (AC9)", async () => {
    const res = await createRoute(
      jsonReq("POST", { person_id: "person-3", team_id: "team-a" }, cookieFor("user-worker")),
    );
    expect(res.status).toBe(403);
  });

  it("POST: Coordinator → 201 — إنشاء متطوع (AC2) ويصمد بعد إعادة الطلب (AC3/AC4)", async () => {
    const res = await createRoute(
      jsonReq("POST", { person_id: "person-3", team_id: "team-a" }, cookieFor("user-coordinator")),
    );
    expect(res.status).toBe(201);
    const { volunteer } = await res.json();
    expect(volunteer.status).toBe("active");

    // طلب HTTP منفصل (محاكاة refresh)
    const fetched = await getRoute(
      new Request("http://test/api/volunteers/x", { headers: cookieFor("user-viewer") }),
      { params: Promise.resolve({ id: volunteer.id }) },
    );
    expect(fetched.status).toBe(200);
    const data = await fetched.json();
    expect(data.volunteer.person_id).toBe("person-3");

    // والموجود مباشرة في المخزن
    expect(getRepos().volunteers.getById(volunteer.id)?.team_id).toBe("team-a");
  });

  it("POST: مرجعية غير صالحة → 400 (AC7)", async () => {
    const badPerson = await createRoute(
      jsonReq("POST", { person_id: "nope", team_id: "team-a" }, cookieFor("user-coordinator")),
    );
    expect(badPerson.status).toBe(400);

    const badTeam = await createRoute(
      jsonReq("POST", { person_id: "person-3", team_id: "nope" }, cookieFor("user-coordinator")),
    );
    expect(badTeam.status).toBe(400);
  });

  it("POST: payload غير صالح → 400 (AC8) — ومتكرر نشط → 409", async () => {
    const invalid = await createRoute(
      jsonReq("POST", { person_id: "", team_id: "" }, cookieFor("user-coordinator")),
    );
    expect(invalid.status).toBe(400);

    const dup = await createRoute(
      jsonReq("POST", { person_id: "person-1", team_id: "team-b" }, cookieFor("user-coordinator")),
    );
    expect(dup.status).toBe(409);
  });

  it("PATCH: Coordinator → 200 وتغيّر مخزَّن (read-after-write)", async () => {
    const res = await patchRoute(
      jsonReq("PATCH", { status: "inactive" }, cookieFor("user-coordinator")),
      { params: Promise.resolve({ id: "volunteer-1" }) },
    );
    expect(res.status).toBe(200);
    expect(getRepos().volunteers.getById("volunteer-1")?.status).toBe("inactive");
  });

  it("GET list: Viewer يقرأ (محدود = قراءة فقط)", async () => {
    const res = await listRoute(
      new Request("http://test/api/volunteers", { headers: cookieFor("user-viewer") }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.volunteers).toHaveLength(2);
  });
});
