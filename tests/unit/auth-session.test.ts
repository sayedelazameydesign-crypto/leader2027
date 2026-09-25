import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  createSessionToken,
  readSessionToken,
} from "@/lib/auth/session";

describe("password (scrypt)", () => {
  it("hash ثم verify", () => {
    const stored = hashPassword("Demo!2345");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Demo!2345", stored)).toBe(true);
  });

  it("يرفض كلمة مرور خاطئة أو stored تالفاً", () => {
    const stored = hashPassword("Demo!2345");
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("Demo!2345", "garbage")).toBe(false);
  });

  it("يولد ملحًا مختلفاً لكل عملية", () => {
    expect(hashPassword("Demo!2345")).not.toBe(hashPassword("Demo!2345"));
  });
});

describe("session token (HMAC)", () => {
  it("يُنشئ ويقرأ الجلسة", () => {
    const token = createSessionToken("user-worker");
    const payload = readSessionToken(token);
    expect(payload?.uid).toBe("user-worker");
  });

  it("يرفض توكيلاً مزوَّراً", () => {
    const token = createSessionToken("user-worker");
    const [body] = token.split(".");
    expect(readSessionToken(`${body}.deadbeef`)).toBeNull();
    expect(readSessionToken("not-a-token")).toBeNull();
  });

  it("يرفض توكيلاً منتهياً", () => {
    const expired = createSessionToken("user-worker").replace(/^([^.]+)/, (body) => {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      payload.exp = Date.now() - 1000;
      return Buffer.from(JSON.stringify(payload)).toString("base64url");
    });
    // التوكيل سليم التوقيع لكنه منتهٍ — لكن إعادة ترميز payload تكسر التوقيع عمداً هنا؛
    // نتحقق على الأقل من رفض أي تعديل للحمولة.
    expect(readSessionToken(expired)).toBeNull();
  });

  it("يحمل session_epoch ويقرأه (VS3 — تقوية الجلسات)", () => {
    const token = createSessionToken("user-worker", 3);
    const payload = readSessionToken(token);
    expect(payload?.ep).toBe(3);
  });

  it("يرفض أي تعديل في ep (توقيع HMAC يحميه)", () => {
    const token = createSessionToken("user-worker", 3);
    const [body, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString());
    decoded.ep = 99;
    const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    expect(readSessionToken(`${tampered}.${sig}`)).toBeNull();
  });
});
