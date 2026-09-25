import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "l27_session";
const TTL_MS = 12 * 3600 * 1000;

/**
 * P2 — startup fail-closed.
 *
 * السابق: `process.env.L27_SESSION_SECRET ?? "l27-dev-secret-change-me"` —
 * سرّ ثابت مكشوف في المستودع. على الإنتاج يعني ذلك أن أي قارئ للمصدر يستطيع
 * تزوير cookie جلسة لأي مستخدم (OWNER ضمناً) = إقلاع ناجح بثغرة (fail-open).
 *
 * الآن: الإنتاج **يرفض توقيع/قراءة أي جلسة** بلا سرّ صريح كافٍ، والرفض مُثبَّت
 * في CI نفسه (خطوة «fail-closed proof») لا في README فقط.
 */
export const DEV_SESSION_SECRET = "l27-dev-secret-change-me";
export const MIN_SECRET_LENGTH = 16;

export type SessionSecretIssue = "missing" | "too_short" | "dev_secret";

export function sessionSecretIssue(raw: string | undefined): SessionSecretIssue | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return "missing";
  if (raw.trim().length < MIN_SECRET_LENGTH) return "too_short";
  if (raw === DEV_SESSION_SECRET) return "dev_secret";
  return null;
}

function failMessage(issue: SessionSecretIssue): string {
  const base = "رفض الإقلاع (fail-closed): ";
  if (issue === "missing") {
    return `${base}L27_SESSION_SECRET غير معرّف — لا يمكن توقيع الجلسات على الإنتاج. عرّفه (≥ ${MIN_SECRET_LENGTH} حرفاً) وأعد التشغيل.`;
  }
  if (issue === "too_short") {
    return `${base}L27_SESSION_SECRET أقصر من ${MIN_SECRET_LENGTH} حرفاً — سرّ ضعيف. ولّد سراً عشوائياً طويلاً وأعد التشغيل.`;
  }
  return `${base}L27_SESSION_SECRET مساوٍ لسرّ التطوير المنشور في المستودع — مكشوف للجميع. غيّره على الإنتاج.`;
}

/**
 * دالة نقية (تُختبر بلا لمس process.env):
 * production ← سرّ صريح صالح أو رفض؛ غير production ← سرّ التطوير (بلا انحدار).
 */
export function resolveSessionSecret(
  nodeEnv: string | undefined,
  raw: string | undefined,
): string {
  if (nodeEnv === "production") {
    const issue = sessionSecretIssue(raw);
    if (issue) throw new Error(failMessage(issue));
    return (raw as string).trim();
  }
  return DEV_SESSION_SECRET;
}

/**
 * التحقّق عند أول استخدام (lazy) لا عند تحميل الـmodule:
 * - `next build` يجمع route modules بلا بيئة إنتاج كاملة ⇒ لا ينكسر البناء.
 * - أول طلب مصادقة على إنتاج بلا سرّ ⇒ استثناء برسالة إصلاح واضحة.
 * - يُحسب مرة واحدة لكل عالم module (السرّ لا يتغير أثناء التشغيل).
 */
let resolved: string | null = null;

function secret(): string {
  if (resolved === null) {
    resolved = resolveSessionSecret(process.env.NODE_ENV, process.env.L27_SESSION_SECRET);
  }
  return resolved;
}

/** للاختبارات فقط — إعادة ضبط السرّ المحلول بعد تغيير البيئة. */
export function resetSessionSecretCache(): void {
  resolved = null;
}

type Payload = { uid: string; exp: number; ep: number };

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createSessionToken(userId: string, sessionEpoch = 0): string {
  const payload: Payload = { uid: userId, exp: Date.now() + TTL_MS, ep: sessionEpoch };
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string): Payload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as Payload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    if (typeof payload.ep !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}
