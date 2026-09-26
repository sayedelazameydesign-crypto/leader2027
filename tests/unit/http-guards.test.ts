import { describe, it, expect, beforeEach } from "vitest";
import { assertSameOrigin, rateLimit, resetRateLimits } from "@/lib/http-guards";

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

describe("محدد المعدل (نافذة منزلقة في الذاكرة)", () => {
  beforeEach(() => resetRateLimits());

  it("يسمح حتى الحد ثم يرفض — وتنفتح النافذة مجددًا بالزمن", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(rateLimit("k1", 5, 1_000, t0 + i)).toBe(true);
    }
    expect(rateLimit("k1", 5, 1_000, t0 + 10)).toBe(false);
    // بعد انتهاء النافذة يُسمح مجددًا
    expect(rateLimit("k1", 5, 1_000, t0 + 2_000)).toBe(true);
  });

  it("مفاتيح معزولة — مفتاح واحد لا يُنهك غيره", () => {
    expect(rateLimit("a", 1, 1_000, 0)).toBe(true);
    expect(rateLimit("a", 1, 1_000, 0)).toBe(false);
    expect(rateLimit("b", 1, 1_000, 0)).toBe(true);
  });
});
