import { describe, it, expect, afterEach } from "vitest";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";

const saved: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  for (const k of Object.keys(saved)) delete saved[k];
});

describe("سر الجلسة في الإنتاج (VS5/T2)", () => {
  it("التطوير/الاختبار يبقيان على الافتراضي بلا احتكاك", () => {
    setEnv("NODE_ENV", "test");
    setEnv("L27_SESSION_SECRET", undefined);
    const token = createSessionToken("user-viewer");
    expect(readSessionToken(token)?.uid).toBe("user-viewer");
  });

  it("الإنتاج على السر الافتراضي يرفض التوقيع صراحةً", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PHASE", undefined);
    setEnv("L27_SESSION_SECRET", undefined);
    setEnv("L27_ALLOW_INSECURE_SECRET", undefined);
    expect(() => createSessionToken("user-viewer")).toThrow(/L27_SESSION_SECRET/);
  });

  it("الإنتاج على السر الافتراضي الصريح يرفض أيضًا", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_SESSION_SECRET", "l27-dev-secret-change-me");
    expect(() => createSessionToken("user-viewer")).toThrow(/L27_SESSION_SECRET/);
  });

  it("الإنتاج بسرّ حقيقي يعمل — والتوكن يُقرأ", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_SESSION_SECRET", "a-real-secret-with-enough-entropy-32ch");
    const token = createSessionToken("user-owner", 2);
    const payload = readSessionToken(token);
    expect(payload?.uid).toBe("user-owner");
    expect(payload?.ep).toBe(2);
  });

  it("الاستثناء الصريح L27_ALLOW_INSECURE_SECRET=1 يسمح (اختبارات إنتاج فقط)", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_SESSION_SECRET", undefined);
    setEnv("L27_ALLOW_INSECURE_SECRET", "1");
    expect(readSessionToken(createSessionToken("user-viewer"))?.uid).toBe("user-viewer");
  });

  it("دورة البناء next build معفاة (NEXT_PHASE)", () => {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PHASE", "phase-production-build");
    setEnv("L27_SESSION_SECRET", undefined);
    expect(readSessionToken(createSessionToken("user-viewer"))?.uid).toBe("user-viewer");
  });

  it("سرّان مختلفان ⇒ التوكن القديم يُرفض", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_SESSION_SECRET", "secret-number-one-aaaaaaaaaaaaaaaa");
    const token = createSessionToken("user-viewer");
    setEnv("L27_SESSION_SECRET", "secret-number-two-bbbbbbbbbbbbbbbb");
    expect(readSessionToken(token)).toBeNull();
  });
});
