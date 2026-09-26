import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { resetRateLimits } from "@/lib/rate-limit";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as peoplePost } from "@/app/api/people/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function loginReq(email: string, password: string, headers: Record<string, string> = {}) {
  return new Request("http://test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email, password }),
  });
}

const saved: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  setRepos(createMemoryRepos(seededStore()));
  resetRateLimits();
});
afterEach(() => {
  setRepos(null);
  resetRateLimits();
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  for (const k of Object.keys(saved)) delete saved[k];
});

describe("أمن الدخول والكوكي (مراجعة ما قبل النشر)", () => {
  it("الكوكي: HttpOnly + SameSite=Lax + Path — وSecure في الإنتاج", async () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_ALLOW_INSECURE_SECRET", "1");
    const res = await loginPost(loginReq("viewer@leader2027.test", "Demo!2345"));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it("التطوير بلا Secure (http محلي يعمل) — وبقية الأعلام باقية", async () => {
    setEnv("NODE_ENV", "development");
    const res = await loginPost(loginReq("viewer@leader2027.test", "Demo!2345"));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("CSRF: POST من Origin أجنبي ⇒ 403 على login وعلى API", async () => {
    const evil = { origin: "https://evil.example" };
    const login = await loginPost(loginReq("viewer@leader2027.test", "Demo!2345", evil));
    expect(login.status).toBe(403);

    const create = await peoplePost(
      new Request("http://test/api/people", {
        method: "POST",
        headers: { "content-type": "application/json", ...cookieFor("user-coordinator"), ...evil },
        body: JSON.stringify({ full_name: "شخص CSRF", source: "ميداني" }),
      }),
    );
    expect(create.status).toBe(403);
  });

  it("CSRF: Origin مطابق يعمل بشكل طبيعي", async () => {
    const res = await peoplePost(
      new Request("http://test/api/people", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...cookieFor("user-coordinator"),
          origin: "http://test",
        },
        body: JSON.stringify({ full_name: "شخص سليم", source: "ميداني" }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("مُخدد الدخول: 10 محاولات/دقيقة لكل (IP × بريد) ثم 429", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 10; i += 1) {
      const res = await loginPost(loginReq("viewer@leader2027.test", "wrong-pass", headers));
      expect(res.status).toBe(401);
    }
    const limited = await loginPost(loginReq("viewer@leader2027.test", "wrong-pass", headers));
    expect(limited.status).toBe(429);
    // نفس البريد من IP آخر لا يتأثّر
    const other = await loginPost(
      loginReq("viewer@leader2027.test", "wrong-pass", { "x-forwarded-for": "198.51.100.9" }),
    );
    expect(other.status).toBe(401);
  });
});
