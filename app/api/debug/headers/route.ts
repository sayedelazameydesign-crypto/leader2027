import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * T4 — إثبات هوية الحافة الحيّة (route تشخيصي + curl).
 * **مُقيَّد بمتغير صريح `L27_DEBUG_HEADERS=1` — وإلا 404.** ليس محميًا بجلسة
 * (يعرض ترويسات الناطق نفسه فقط)، لكنه مُطفأ افتراضيًا لأنه بصمة بنية
 * (يكشف أنه Vercel). القرار: يُفعَّل في مرحلة deploy للتحقق ثم **تُحذف القيمة
 * في finalize ولا يُفعَّل في الإنتاج بعدها أبدًا** — الكود يبقى للاستخدام
 * التشغيلي المؤقت وحده. يعكس 3 ترويسات فقط — لا أسرار ولا بيئات.
 */
export async function GET(req: Request) {
  if (process.env.L27_DEBUG_HEADERS !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(
    {
      realIp: req.headers.get("x-real-ip"),
      vercelFwd: req.headers.get("x-vercel-forwarded-for"),
      xff: req.headers.get("x-forwarded-for"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
