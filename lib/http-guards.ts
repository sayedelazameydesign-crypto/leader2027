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
 * **الإنتاج يُصرِّح**: `L27_ALLOWED_HOSTS` أو `L27_TRUST_EDGE=1` — وإلا فشل صريح.
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

/**
 * هوية العميل للمُخدد — **ترويسة موثوقة واحدة فقط**، لا `x-forwarded-for`
 * أبدًا (أيسر عنصر في قائمتها يتحكم فيه العميل — نفس فئة تجاوز `x-l27-agent`).
 * المصدر: `L27_CLIENT_IP_HEADER` (افتراضي `x-real-ip` — تضعها Vercel مُنظَّفة).
 * غياب الترويسة ⇒ دلو `unknown` مشترك (موثّق) — لا تخمين من XFF إطلاقًا.
 */
export function clientIp(req: Request): string {
  const header = process.env.L27_CLIENT_IP_HEADER ?? "x-real-ip";
  const value = req.headers.get(header)?.split(",")[0]?.trim();
  return value || "unknown";
}

/**
 * متطلبات الإنتاج (البند ج): الإنتاج **يجب** أن يعلن سياسة الأصل صراحةً —
 * إما `L27_ALLOWED_HOSTS` (المُوصى به) أو `L27_TRUST_EDGE=1` (حافة مُنظِّفة
 * موثوقة ديناميكية المضيف مثل معاينات الوسيط). بلاهما ⇒ فشل صريح لا سقوط
 * صامت إلى ثقة XFH. دورة البناء معفاة.
 */
function assertOriginPolicyConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const hasAllowlist = !!(process.env.L27_ALLOWED_HOSTS ?? "").trim();
  const trustsEdge = process.env.L27_TRUST_EDGE === "1";
  if (!hasAllowlist && !trustsEdge) {
    throw new Error(
      "سياسة الأصل مطلوبة في الإنتاج: اضبط L27_ALLOWED_HOSTS (موصى به) أو L27_TRUST_EDGE=1 " +
        "لحافة مُنظِّفة موثوقة — لا يُسمح بثقة XFH صامتة. انظر .env.example",
    );
  }
}

/** يرفض Origin أجنبيًا على الطرق المُغيِّرة — 403. */
export function assertSameOrigin(req: Request): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  assertOriginPolicyConfigured();

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
