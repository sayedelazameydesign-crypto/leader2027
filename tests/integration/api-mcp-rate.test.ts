import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { resetRateLimits } from "@/lib/rate-limit";
import { POST as mcpPost } from "@/app/api/mcp/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function initReq(headers: Record<string, string>) {
  return new Request("http://test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

beforeEach(() => {
  setRepos(createMemoryRepos(seededStore()));
  resetRateLimits();
});
afterEach(() => {
  setRepos(null);
  resetRateLimits();
});

describe("مُخدد بوابة الوكلاء", () => {
  it("البند 1: تغيير x-l27-agent في كل طلب لا يتجاوز الحد — المفتاح user.id", async () => {
    // 60 طلبًا وكيلها يتغيّر كل مرة ⇒ دلو واحد للمستخدم مهما تبدّلت الترويسة
    for (let i = 0; i < 60; i += 1) {
      const res = await mcpPost(initReq({ ...cookieFor("user-viewer"), "x-l27-agent": `spoof-${i}` }));
      expect(res.status).toBe(200);
    }
    // الـ61 باسم وكيل جديد تمامًا ⇒ يُرفض من سقف المستخدم
    const limited = await mcpPost(
      initReq({ ...cookieFor("user-viewer"), "x-l27-agent": "brand-new-agent" }),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe(-32029);
  });

  it("البند 1: حد الوكيل الثانوي (20/دقيقة) تحت سقف المستخدم", async () => {
    const headers = { ...cookieFor("user-viewer"), "x-l27-agent": "busy-agent" };
    for (let i = 0; i < 20; i += 1) {
      expect((await mcpPost(initReq(headers))).status).toBe(200);
    }
    // الوكيل نفسه مرهون — والوكيل الآخر ما زال مسموحاً (سقف المستخدم لم يبلغ)
    expect((await mcpPost(initReq(headers))).status).toBe(429);
    const otherAgent = await mcpPost(
      initReq({ ...cookieFor("user-viewer"), "x-l27-agent": "fresh-agent" }),
    );
    expect(otherAgent.status).toBe(200);
  });

  it("مستخدم آخر معزول تمامًا عن دلو الأول", async () => {
    for (let i = 0; i < 60; i += 1) {
      await mcpPost(initReq({ ...cookieFor("user-viewer"), "x-l27-agent": `a-${i}` }));
    }
    expect((await mcpPost(initReq(cookieFor("user-viewer")))).status).toBe(429);
    expect((await mcpPost(initReq(cookieFor("user-coordinator")))).status).toBe(200);
  });

  it("البند 5: مُخدد IP قبل المصادقة — فيضان غير مصادَق يُكبح بلا DB lookup", async () => {
    const headers = { "x-forwarded-for": "203.0.113.55" };
    for (let i = 0; i < 120; i += 1) {
      const res = await mcpPost(initReq(headers));
      expect(res.status).toBe(401); // يُكبح قبل المصادقة لكنه لا يُحمَّل DB
    }
    const limited = await mcpPost(initReq(headers));
    expect(limited.status).toBe(429);
    // IP آخر لا يتأثّر
    const other = await mcpPost(initReq({ "x-forwarded-for": "198.51.100.20" }));
    expect(other.status).toBe(401);
  });

  it("الردود تحمل Cache-Control: no-store (البند 10)", async () => {
    const res = await mcpPost(initReq(cookieFor("user-viewer")));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
