import { describe, it, expect, afterEach } from "vitest";
import {
  DEV_SESSION_SECRET,
  MIN_SECRET_LENGTH,
  resolveSessionSecret,
  sessionSecretIssue,
  createSessionToken,
  readSessionToken,
  resetSessionSecretCache,
} from "@/lib/auth/session";

const VALID = "ci-only-secret-0123456789";

// NODE_ENV مُعلَن read-only في أنواع Next — نعدّله عبر واجهة قابلة للكتابة
// (سلوك الاختبار نفسه: env فعلي يُقرأ من resolveSessionSecret داخل session.ts).
const env = process.env as unknown as Record<string, string | undefined>;
const ENV_KEYS = ["NODE_ENV", "L27_SESSION_SECRET"];
const saved = ENV_KEYS.map((key) => [key, env[key]] as const);

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  resetSessionSecretCache();
});

describe("P2 — resolveSessionSecret (قاعدة نقية، بلا process.env)", () => {
  it("production: ترفض سراً مفقوداً أو فارغاً أو مسافات", () => {
    expect(() => resolveSessionSecret("production", undefined)).toThrow(/fail-closed/);
    expect(() => resolveSessionSecret("production", "")).toThrow(/L27_SESSION_SECRET/);
    expect(() => resolveSessionSecret("production", "   ")).toThrow(/fail-closed/);
  });

  it("production: ترفض سراً أقصر من الحد الأدنى", () => {
    const short = "x".repeat(MIN_SECRET_LENGTH - 1);
    expect(() => resolveSessionSecret("production", short)).toThrow(
      new RegExp(`أقصر من ${MIN_SECRET_LENGTH}`),
    );
  });

  it("production: ترفض سرّ التطوير المنشور في المستودع (مكشوف)", () => {
    expect(() => resolveSessionSecret("production", DEV_SESSION_SECRET)).toThrow(/مساوٍ لسرّ التطوير/);
    expect(sessionSecretIssue(DEV_SESSION_SECRET)).toBe("dev_secret");
  });

  it("production: تقبل سراً صريحاً كافياً (≥16) وتعيده كما هو", () => {
    expect(resolveSessionSecret("production", VALID)).toBe(VALID);
    expect(resolveSessionSecret("production", "x".repeat(MIN_SECRET_LENGTH))).toHaveLength(
      MIN_SECRET_LENGTH,
    );
    expect(sessionSecretIssue(VALID)).toBeNull();
  });

  it("غير production: تسقط لسرّ التطوير — development/test لا ينكسران", () => {
    expect(resolveSessionSecret("development", undefined)).toBe(DEV_SESSION_SECRET);
    expect(resolveSessionSecret("test", undefined)).toBe(DEV_SESSION_SECRET);
    expect(resolveSessionSecret(undefined, undefined)).toBe(DEV_SESSION_SECRET);
    // سرّ صريح في التطوير مقبول أيضاً (لا يُجبر أحد على السرّ المكشوف)
    expect(resolveSessionSecret("development", VALID)).toBe(DEV_SESSION_SECRET);
  });

  it("sessionSecretIssue يصنّف الحالات الثلاث", () => {
    expect(sessionSecretIssue(undefined)).toBe("missing");
    expect(sessionSecretIssue("abc")).toBe("too_short");
    expect(sessionSecretIssue(DEV_SESSION_SECRET)).toBe("dev_secret");
    expect(sessionSecretIssue(VALID)).toBeNull();
  });
});

describe("P2 — التكامل مع البيئة الحقيقية (process.env) وتوقيع الجلسات", () => {
  it("بيئة الاختبار الحالية: التوكن يُوقَّع ويُقرأ (بلا انحدار)", () => {
    resetSessionSecretCache();
    const token = createSessionToken("user-owner", 2);
    expect(readSessionToken(token)?.uid).toBe("user-owner");
    expect(readSessionToken(token)?.ep).toBe(2);
  });

  it("NODE_ENV=production بلا سرّ ⇒ توقيع الجلسة يرفض (fail-closed عند أول استخدام)", () => {
    env.NODE_ENV = "production";
    delete env.L27_SESSION_SECRET;
    resetSessionSecretCache();
    expect(() => createSessionToken("user-owner")).toThrow(/fail-closed/);
    expect(() => readSessionToken("x.y")).toThrow(/fail-closed/);
  });

  it("NODE_ENV=production + سرّ صالح ⇒ يعمل، والتوكن مربوط بالسرّ", () => {
    env.NODE_ENV = "production";
    env.L27_SESSION_SECRET = VALID;
    resetSessionSecretCache();
    const token = createSessionToken("user-owner", 0);
    expect(readSessionToken(token)?.uid).toBe("user-owner");

    // تغيير السرّ يُبطل التوكن القديم (لا توقيع عابر للبيئات)
    env.L27_SESSION_SECRET = "another-ci-secret-987654321";
    resetSessionSecretCache();
    expect(readSessionToken(token)).toBeNull();
  });

  it("NODE_ENV=production + سرّ التطوير ⇒ يرفض حتى لو «معرّف»", () => {
    env.NODE_ENV = "production";
    env.L27_SESSION_SECRET = DEV_SESSION_SECRET;
    resetSessionSecretCache();
    expect(() => createSessionToken("user-owner")).toThrow(/مساوٍ لسرّ التطوير/);
  });
});
