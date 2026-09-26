/**
 * أدوات حماية سطح HTTP — VS5 (مراجعة ما قبل النشر).
 *
 * `assertSameOrigin` — دفاع CSRF عميق: طلبات المتصفح المُغيِّرة (POST/PATCH/…)
 * يجب أن تحمل Origin مطابقًا للمضيف. SameSite=Lax + JSON-only يفعلان الأصل،
 * وهذه الطبقة تُغلق ما تبقّى (متصفح قديم، subdomain). الطلبات بلا Origin
 * (curl/اختبارات) تُقبل — CSRF ظاهرة متصفحية، والتوثيق يبقى الجلسة الموقّعة.
 *
 * مُخدد المعدل انتقل إلى `lib/rate-limit.ts` (واجهة قابلة للاستبدال: ذاكرة/Postgres).
 */
import { NextResponse } from "next/server";

/** يرفض Origin أجنبيًا على الطرق المُغيِّرة — 403. */
export function assertSameOrigin(req: Request): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const origin = req.headers.get("origin");
  if (!origin) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return NextResponse.json({ errors: { _auth: "Origin غير صالح" } }, { status: 403 });
  }

  const candidates: string[] = [];
  const forwarded = req.headers.get("x-forwarded-host");
  if (forwarded) candidates.push(...forwarded.split(",").map((h) => h.trim()));
  const host = req.headers.get("host");
  if (host) candidates.push(host);
  try {
    candidates.push(new URL(req.url).host);
  } catch {
    /* url نسبي */
  }

  if (candidates.includes(originHost)) return null;
  return NextResponse.json(
    { errors: { _auth: "طلب من أصل غير مطابق (CSRF) — مرفوض" } },
    { status: 403 },
  );
}
