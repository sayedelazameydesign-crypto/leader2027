/**
 * أدوات حماية سطح HTTP — VS5 (مراجعة ما قبل النشر).
 *
 * 1) `assertSameOrigin` — دفاع CSRF عميق: طلبات المتصفح المُغيِّرة (POST/PATCH/…)
 *    يجب أن تحمل Origin مطابقًا للمضيف. SameSite=Lax + JSON-only يفعلان الأصل،
 *    وهذه الطبقة تُغلق ما تبقّى. الطلبات بلا Origin (curl/اختبارات) تُقبل — CSRF
 *    ظاهرة متصفحية، والتوثيق يبقى الجلسة الموقّعة.
 * 2) `rateLimit` — مُخدد معدّل في الذاكرة لكل عملية (نافذة منزلقة). كبح للتخمين
 *    والإساءة، وليس حدًا عالميًا — على serverless متعدد الحالات يُكمَّل بمخدد
 *    مُوزَّع (V5.2+).
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

type Bucket = number[];

const buckets = new Map<string, Bucket>();

/** يسمح إن كان تحت الحد داخل النافذة — وإلا false. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const bucket = buckets.get(key) ?? [];
  const cutoff = now - windowMs;
  const recent = bucket.filter((t) => t > cutoff);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

/** للاختبارات — مسح المخزّن. */
export function resetRateLimits(): void {
  buckets.clear();
}
