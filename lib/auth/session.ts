import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "l27_session";
const DEV_SECRET = "l27-dev-secret-change-me";
const TTL_MS = 12 * 3600 * 1000;

type Payload = { uid: string; exp: number; ep: number };

let warned = false;
function warnOnce(message: string): void {
  if (!warned) {
    console.warn(`⚠️ ${message}`);
    warned = true;
  }
}

/**
 * سرّ التوقيع — VS5/T2: الإنتاج **يرفض** السر الافتراضي إطلاقًا.
 * التطوير والاختبار يبقيان على الافتراضي (بلا احتكاك)، والاستثناء الصريح
 * للاختبارات الإنتاجية وحدها: `L27_ALLOW_INSECURE_SECRET=1` (يُحذَّر منه في الإنتاج).
 * دورة البناء (`NEXT_PHASE`) معفاة — لا توقيع جلسات يحدث أثناء `next build`،
 * وإن حدث استثناءً فيُحذَّر منه مرة واحدة (لا توقيع صامت بسرّ التطوير).
 */
function secret(): string {
  const configured = process.env.L27_SESSION_SECRET;
  const inProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
  const insecure = !configured || configured === DEV_SECRET;
  const allowInsecure = process.env.L27_ALLOW_INSECURE_SECRET === "1";
  if (process.env.NODE_ENV === "production" && !inProductionBuild && !allowInsecure) {
    if (insecure) {
      throw new Error(
        "L27_SESSION_SECRET مطلوب في الإنتاج — الافتراضي غير آمن. " +
          "اضبط سرًا عشوائيًا (32+ حرفًا) أو استثني صراحةً بـ L27_ALLOW_INSECURE_SECRET=1 (اختبارات فقط).",
      );
    }
    // حد الطول مقصود: الافتراضي المرفوض وحده لا يكفي — سرّ قصير (أو متوقّع)
    // في الإنتاج مرفوض صراحةً.
    if ((configured ?? "").length < 32) {
      throw new Error(
        "L27_SESSION_SECRET قصير — 32 حرفًا عشوائيًا على الأقل مطلوب في الإنتاج (أقل من ذلك إنتروبيا غير كافية للتوقيع HMAC).",
      );
    }
  }
  if (process.env.NODE_ENV === "production" && allowInsecure && insecure) {
    warnOnce("L27_ALLOW_INSECURE_SECRET=1 فعّال في الإنتاج — الجلسات تُوقَّع بسرّ التطوير. لا تستخدمه في نشر حقيقي.");
  }
  if (process.env.NODE_ENV === "production" && inProductionBuild && insecure) {
    warnOnce("توقيع جلسة أثناء دورة البناء بسرّ التطوير (NEXT_PHASE) — لا تُصدِّر هذا التوكن.");
  }
  return configured ?? DEV_SECRET;
}

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
