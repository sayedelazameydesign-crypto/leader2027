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
  delete process.env.L27_CLIENT_IP_HEADER;
});

describe("مُخدد بوابة الوكلاء", () => {
  const savedTrust = process.env.L27_TRUST_EDGE;
  beforeEach(() => {
    // الإنتاج خلف edge موثوق (Vercel) — الهوية من ترويسة مُنظَّفة.
    process.env.L27_TRUST_EDGE = "1";
    resetRateLimits();
  });
  afterEach(() => {
    if (savedTrust === undefined) delete process.env.L27_TRUST_EDGE;
    else process.env.L27_TRUST_EDGE = savedTrust;
  });

  it("🔴 XFF متغيّر في كل طلب لا يتجاوز الحد — الهوية من الترويسة الموثوقة لا XFF", async () => {
    // كل طلب بترويسة x-forwarded-for مختلفة (يتحكم بها المهاجم) — ولو كانت موثوقة
    // لفتح دلواً جديداً لكل طلب ولما بلغ الحد أبداً. المطلوب: الحد يبقى كما هو.
    let last = 0;
    for (let i = 0; i < 61; i += 1) {
      last = (
        await mcpPost(initReq({ "x-forwarded-for": `203.0.113.${i}` }))
      ).status;
      if (i < 60) expect(last).toBe(401); // فشل مصادقة — يُستهلك من دلو الفشل
    }
    expect(last).toBe(429); // الـ61 ⇒ دلو الفشل امتلأ رغم تدوير XFF
  });

  it("🔴 بلا L27_TRUST_EDGE: x-real-ip مُزوّرة لا تفتح دلاء — الجميع في unknown (429 عند الـ61)", async () => {
    // وضع "الخادم المكشوف" (ALLOWED_HOSTS بلا edge): لا ثقة لأي ترويسة IP —
    // حتى x-real-ip يكتبها العميل بنفسه. المتمنّع هنا يدور x-real-ip كل طلب:
    // يجب ألّا يفتح دلوًا جديدًا (كلها unknown مشترك).
    delete process.env.L27_TRUST_EDGE;
    let last = 0;
    for (let i = 0; i < 61; i += 1) {
      last = (await mcpPost(initReq({ "x-real-ip": `203.0.113.${i}` }))).status;
      if (i < 60) expect(last).toBe(401);
    }
    expect(last).toBe(429); // الدلو المشترك امتلأ — التزوير لم يمنح هوية
  });

  it("الهوية الموثوقة (x-real-ip) تفصل الدلاء فعلاً — ضابط إيجابي", async () => {
    for (let i = 0; i < 60; i += 1) {
      await mcpPost(initReq({ "x-real-ip": "198.51.100.1" }));
    }
    expect((await mcpPost(initReq({ "x-real-ip": "198.51.100.1" }))).status).toBe(429);
    // IP مختلف حيّله مستقلة — يبدأ من رصيده
    expect((await mcpPost(initReq({ "x-real-ip": "198.51.100.2" }))).status).toBe(401);
  });

  it("L27_CLIENT_IP_HEADER يغيّر مصدر الحقيقة (لا XFF افتراضيًا)", async () => {
    process.env.L27_CLIENT_IP_HEADER = "cf-connecting-ip";
    for (let i = 0; i < 60; i += 1) {
      await mcpPost(initReq({ "cf-connecting-ip": "203.0.113.9" }));
    }
    // الترويسة الموثوقة وحدها التي تُستهلك — ولو مرّرت XFF بترويسات مختلفة
    expect(
      (await mcpPost(initReq({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }))).status,
    ).toBe(429);
  });

  it("البند 1: تغيير x-l27-agent في كل طلب لا يتجاوز الحد — المفتاح user.id", async () => {
    for (let i = 0; i < 60; i += 1) {
      const res = await mcpPost(initReq({ ...cookieFor("user-viewer"), "x-l27-agent": `spoof-${i}` }));
      expect(res.status).toBe(200);
    }
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
    expect((await mcpPost(initReq(headers))).status).toBe(429);
    const otherAgent = await mcpPost(
      initReq({ ...cookieFor("user-viewer"), "x-l27-agent": "fresh-agent" }),
    );
    expect(otherAgent.status).toBe(200);
  });

  it("🟠 NAT: مستخدمون شرعيون خلف IP واحد لا يُحجبون عند حدّ الفشل", async () => {
    const nat = { "x-real-ip": "10.0.0.7" };
    // 3 مستخدمين × 20 نجاحًا = 60 طلبًا شرعيًا من IP واحد — بلا حجب IP مطلقًا
    for (const uid of ["user-viewer", "user-coordinator", "user-manager"]) {
      for (let i = 0; i < 20; i += 1) {
        const res = await mcpPost(initReq({ ...cookieFor(uid), ...nat }));
        expect(res.status).toBe(200);
      }
    }
    // الحد الذي يُحمَّل هو سقف المستخدم (60) لا سقف IP — نُكمل viewer إلى 60
    for (let i = 0; i < 40; i += 1) {
      expect((await mcpPost(initReq({ ...cookieFor("user-viewer"), ...nat }))).status).toBe(200);
    }
    expect((await mcpPost(initReq({ ...cookieFor("user-viewer"), ...nat }))).status).toBe(429);
  });

  it("الردود تحمل Cache-Control: no-store (البند 10)", async () => {
    const res = await mcpPost(initReq(cookieFor("user-viewer")));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
