/**
 * أدوات حماية سطح HTTP — VS5 (مراجعة ما قبل النشر).
 *
 * `assertSameOrigin` — دفاع CSRF عميق: طلبات المتصفح المُغيِّرة (POST/PATCH/…)
 * يجب أن تحمل Origin مطابقًا للمضيف. SameSite=Lax + JSON-only يفعلان الأصل،
 * وهذه الطبقة تُغلق ما تبقّى (متصفح قديم، subdomain). الطلبات بلا Origin
 * (curl/اختبارات) تُقبل — CSRF ظاهرة متصفحية، والتوثيق يبقى الجلسة الموقّعة.
 *
 * المقارنة على **أسماء المضيفين مُطبَّعة** (حالة أحرف + بلا منفذ) — لأن
 * `new URL("https://x:443")` يُسقط `:443` بينما قد تحمل ترويسة Host إياها.
 *
 * الثقة في `x-forwarded-host`: تُقرأ فقط في الوضع المشتق، وهو يفترض حافة
 * مُنظِّفة (Vercel/nginx يستبدل الترويسة ولا يمرّرها العميل). عند التعريض
 * المباشر: اضبط `L27_ALLOWED_HOSTS=example.com,app.example.com` — عندها
 * **لا يُقبل إلا ما في القائمة** ولا تُقرأ ترويسات البروكسي إطلاقًا.
 *
 * مُخدد المعدل انتقل إلى `lib/rate-limit.ts` (واجهة قابلة للاستبدال: ذاكرة/Postgres).
 */
import { NextResponse } from "next/server";

/** اسم مضيف مُطبَّع: حالة أحرف صغيرة + بلا منفذ (قارن hostname لا host:port). */
function normalizeHost(value: string): string {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return value.toLowerCase().split(":")[0];
  }
}

/** يرفض Origin أجنبيًا على الطرق المُغيِّرة — 403. */
export function assertSameOrigin(req: Request): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const origin = req.headers.get("origin");
  if (!origin) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return NextResponse.json({ errors: { _auth: "Origin غير صالح" } }, { status: 403 });
  }

  // الوضع الصارم: قائمة مضيفين من البيئة — لا بروكسي ولا استنتاج.
  const allowlist = (process.env.L27_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .map(normalizeHost);

  if (allowlist.length > 0) {
    if (allowlist.includes(originHost)) return null;
    return NextResponse.json(
      { errors: { _auth: "طلب من أصل غير مطابق (CSRF) — مرفوض" } },
      { status: 403 },
    );
  }

  // الوضع المشتق (حافة مُنظِّفة مفترضة): المضيف + ترويسات البروكسي + مضيف الطلب.
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

  if (candidates.map(normalizeHost).includes(originHost)) return null;
  return NextResponse.json(
    { errors: { _auth: "طلب من أصل غير مطابق (CSRF) — مرفوض" } },
    { status: 403 },
  );
}
