import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { getSessionUser, publicUser } from "@/lib/auth/request";
import { GET as usersGet, POST as usersPost } from "@/app/api/users/route";
import { PATCH as userPatch } from "@/app/api/users/[id]/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { GET as peopleGet } from "@/app/api/people/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function jsonReq(url: string, method: string, body: unknown, headers: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

const validUser = {
  name: "مستخدم جديد",
  email: "new.user@leader2027.test",
  password: "StrongPass!1",
  role: "FIELD_WORKER",
  team_id: "team-a",
};

describe("api-users: create → login + authz + session hardening", () => {
  it("401/403 (AC7): بلا جلسة وCoordinator مرفوض", async () => {
    expect((await usersGet(new Request("http://t/api/users"))).status).toBe(401);
    expect((await usersGet(new Request("http://t/api/users", { headers: cookieFor("user-coordinator") }))).status).toBe(403);
  });

  it("إنشاء مستخدم → بلا password_hash في الاستجابة → يدخل فعلياً (AC5)", async () => {
    const created = await usersPost(jsonReq("http://t/api/users", "POST", validUser, cookieFor("user-manager")));
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("password");
    expect(text).not.toContain("scrypt");
    const { user } = JSON.parse(text);

    const login = await loginPost(jsonReq("http://t/api/auth/login", "POST", {
      email: validUser.email,
      password: validUser.password,
    }, {}));
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE);

    const token = setCookie.match(/l27_session=([^;]+)/)?.[1];
    expect(getSessionUser(getRepos(), decodeURIComponent(token!))?.id).toBe(user.id);
  });

  it("بريد مكرر → 409 — وpayloads غير صالحة → 400 (AC8)", async () => {
    await usersPost(jsonReq("http://t/api/users", "POST", validUser, cookieFor("user-manager")));
    const dup = await usersPost(jsonReq("http://t/api/users", "POST", validUser, cookieFor("user-manager")));
    expect(dup.status).toBe(409);

    const shortPw = await usersPost(jsonReq("http://t/api/users", "POST", { ...validUser, email: "x@y.zz", password: "short" }, cookieFor("user-manager")));
    expect(shortPw.status).toBe(400);

    const badRole = await usersPost(jsonReq("http://t/api/users", "POST", { ...validUser, email: "x@y.zz", role: "ADMIN" }, cookieFor("user-manager")));
    expect(badRole.status).toBe(400);

    const badEmail = await usersPost(jsonReq("http://t/api/users", "POST", { ...validUser, email: "not-an-email" }, cookieFor("user-manager")));
    expect(badEmail.status).toBe(400);

    const political = await usersPost(jsonReq("http://t/api/users", "POST", { ...validUser, email: "p@y.zz", political_score: 1 }, cookieFor("user-manager")));
    expect(political.status).toBe(400);
  });

  it("تغيير الدور يُبطل الجلسة القديمة — 401 (AC6) والجديدة تعمل", async () => {
    const created = await usersPost(jsonReq("http://t/api/users", "POST", validUser, cookieFor("user-manager")));
    const { user } = await created.json();

    // جلسة قديمة للمستخدم الجديد
    const repos = getRepos();
    const stored = repos.users.getById(user.id);
    const oldToken = createSessionToken(user.id, stored!.session_epoch);
    const oldCookie = { cookie: `l27_session=${oldToken}` };
    expect((await peopleGet(new Request("http://t/api/people", { headers: oldCookie }))).status).toBe(200);

    // تغيير الدور → epoch+1
    const patch = await userPatch(jsonReq(`http://t/api/users/${user.id}`, "PATCH", { role: "FIELD_COORDINATOR" }, cookieFor("user-manager")), {
      params: Promise.resolve({ id: user.id }),
    });
    expect(patch.status).toBe(200);
    expect(getRepos().users.getById(user.id)?.session_epoch).toBe(1);

    // الجلسة القديمة مرفوضة
    expect((await peopleGet(new Request("http://t/api/people", { headers: oldCookie }))).status).toBe(401);

    // دخول جديد يعمل
    const login = await loginPost(jsonReq("http://t/api/auth/login", "POST", {
      email: validUser.email, password: validUser.password,
    }, {}));
    expect(login.status).toBe(200);
  });

  it("تغيير الاسم وحده لا يطرد الجلسة (تفسير 4) — وكل mutation بتدقيق (AC9)", async () => {
    const created = await usersPost(jsonReq("http://t/api/users", "POST", validUser, cookieFor("user-manager")));
    const { user } = await created.json();
    const token = createSessionToken(user.id, 0);
    const cookie = { cookie: `l27_session=${token}` };

    const rename = await userPatch(jsonReq(`http://t/api/users/${user.id}`, "PATCH", { name: "اسم محدَّث" }, cookieFor("user-manager")), {
      params: Promise.resolve({ id: user.id }),
    });
    expect(rename.status).toBe(200);
    expect((await peopleGet(new Request("http://t/api/people", { headers: cookie }))).status).toBe(200);

    // email/password مرفوضان في PATCH (v1)
    const forbidden = await userPatch(jsonReq(`http://t/api/users/${user.id}`, "PATCH", { email: "h@x.zz" }, cookieFor("user-manager")), {
      params: Promise.resolve({ id: user.id }),
    });
    expect(forbidden.status).toBe(400);

    const events = getRepos().audit.list().filter((e) => e.entity_type === "user");
    // محاولات مرفوضة (email PATCH) ليست mutations — حدثان ناجحان فقط
    expect(events.map((e) => e.action).sort()).toEqual(["user.create", "user.update"]);
  });

  it("publicUser لا يكشف password_hash أبداً", () => {
    const repos = getRepos();
    const u = repos.users.getById("user-worker")!;
    const safe = publicUser(u);
    expect("password_hash" in safe).toBe(false);
    expect(safe.session_epoch).toBe(0);
  });
});
