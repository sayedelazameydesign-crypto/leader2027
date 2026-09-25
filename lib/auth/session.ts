import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DEV_SESSION_SECRET,
  MIN_SECRET_LENGTH,
  resolveSessionSecret,
  sessionSecretIssue,
  type SessionSecretIssue,
} from "@/lib/runtime/config.mjs";

export const SESSION_COOKIE = "l27_session";
const TTL_MS = 12 * 3600 * 1000;

/**
 * P2 — startup fail-closed (مصدر واحد للقاعدة: `lib/runtime/config.mjs`).
 *
 * السابق: `process.env.L27_SESSION_SECRET ?? "l27-dev-secret-change-me"` — سرّ ثابت
 * منشور في المستودع؛ على الإنتاج يسمح بتزوير cookie جلسة لأي مستخدم (OWNER ضمناً).
 *
 * الآن طبقتان:
 * 1) **بوابة الإقلاع** في `next.config.mjs` (`assertBootEnvironment`) — `next start`
 *    على production بلا سرّ صالح لا يُقلع أصلاً (exit ≠ 0 + رسالة إصلاح). مُثبَّتة
 *    في CI بخطوة «P2 fail-closed proof».
 * 2) **رفض عند أول استخدام** هنا — لأي مسار يُحمّل الوحدة خارج بوابة الإقلاع
 *    (next build / dev / اختبارات) فلا توقيع ولا قراءة بجلسة غير آمنة.
 *
 * إعادة التصدير تُبقي مستوردي `@/lib/auth/session` (والتطبيق) بلا تغيير.
 */
export { DEV_SESSION_SECRET, MIN_SECRET_LENGTH, resolveSessionSecret, sessionSecretIssue };
export type { SessionSecretIssue };

/**
 * التحقّق lazy عند أول توقيع/قراءة — لا عند تحميل الوحدة:
 * `next build` يجمع route modules بلا بيئة إنتاج كاملة فلا ينكسر البناء،
 * والاختبارات (NODE_ENV=test) والتطوير يحتفظان بسرّ التطوير حرفياً.
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
