import { describe, it, expect, beforeEach } from "vitest";
import { assertSameOrigin } from "@/lib/http-guards";
import {
  MemoryRateLimiter,
  PostgresRateLimiter,
  resetRateLimits,
} from "@/lib/rate-limit";

function req(method: string, url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method, headers });
}

describe("فحص الأصل (CSRF defense-in-depth)", () => {
  it("POST بلا Origin ⇒ مقبول (غير المتصفح — curl/اختبارات)", () => {
    expect(assertSameOrigin(req("POST", "http://test/api/people"))).toBeNull();
  });

  it("POST بـOrigin مطابق ⇒ مقبول (host المضيف أو x-forwarded-host)", () => {
    expect(
      assertSameOrigin(req("POST", "http://test/api/people", { origin: "http://test" })),
    ).toBeNull();
    expect(
      assertSameOrigin(
        req("POST", "http://internal:3000/api/people", {
          origin: "https://preview.e2b.app",
          "x-forwarded-host": "preview.e2b.app",
        }),
      ),
    ).toBeNull();
  });

  it("POST بـOrigin أجنبي ⇒ 403", () => {
    const res = assertSameOrigin(
      req("POST", "http://test/api/people", { origin: "https://evil.example" }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("Origin فاسد ⇒ 403 · القراءة (GET) لا تُفحص أصلًا", () => {
    expect(
      assertSameOrigin(req("POST", "http://test/api", { origin: "not-a-url" }))?.status,
    ).toBe(403);
    expect(assertSameOrigin(req("GET", "http://test/api/people", { origin: "https://evil.example" }))).toBeNull();
  });
});

describe("محدد المعدل — الذاكرة (نافذة منزلقة)", () => {
  beforeEach(() => resetRateLimits());

  it("يسمح حتى الحد ثم يرفض — وتنفتح النافذة مجددًا بالزمن", () => {
    const limiter = new MemoryRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check("k1", 5, 1_000, t0 + i)).toBe(true);
    }
    expect(limiter.check("k1", 5, 1_000, t0 + 10)).toBe(false);
    // بعد انتهاء النافذة يُسمح مجددًا
    expect(limiter.check("k1", 5, 1_000, t0 + 2_000)).toBe(true);
  });

  it("مفاتيح معزولة — مفتاح واحد لا يُنهك غيره", () => {
    const limiter = new MemoryRateLimiter();
    expect(limiter.check("a", 1, 1_000, 0)).toBe(true);
    expect(limiter.check("a", 1, 1_000, 0)).toBe(false);
    expect(limiter.check("b", 1, 1_000, 0)).toBe(true);
  });
});

// الحالة الموزَّعة — الدليل الحاسم على أن cold start لا يُفرّغ العدّاد:
// مثيلان مستقلان (كيما حالتا serverless) يشتركان في العدّ عبر القاعدة.
const pgUrl = process.env.L27_TEST_DATABASE_URL;

describe.skipIf(!pgUrl)("محدد المعدل — Postgres موزَّع (حيّ)", () => {
  it("مثيلان مستقلان يشتركان في العدّ — لا يبدأ من صفر مع cold start", async () => {
    const a = new PostgresRateLimiter(pgUrl!);
    const b = new PostgresRateLimiter(pgUrl!);
    const key = `rate-live-${Date.now()}`;
    // المثيل أ يستهلك الحدّ كله
    for (let i = 0; i < 3; i += 1) {
      expect(await a.check(key, 3, 60_000)).toBe(true);
    }
    // المثيل ب (cold start جديد) يرى الحالة كما هي ⇒ يرفض فورًا
    expect(await b.check(key, 3, 60_000)).toBe(false);
  });

  it("فشل القاعدة ⇒ fail-open (سماح) — لا إغلاق للحملة", async () => {
    const broken = new PostgresRateLimiter("postgres://user:bad@127.0.0.1:1/nope");
    expect(await broken.check("k", 1, 1_000)).toBe(true);
  });
});
