import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * T4 — إثبات هوية الحافة الحيّة (ملاحظة المراجعة: route تشخيصي + curl).
 * يعكس ترويسات النطاق الثلاث فقط — لا أسرار ولا بيئات؛ كلها يكتبها العميل/الحافة.
 * الاستخدام: `curl -s https://<domain>/api/debug/headers` ⇒ هل `x-real-ip` مكتوبة
 * فعلًا ومُنظَّفة (قيمة واحدة)؟ البديل عند غيابها: `x-vercel-forwarded-for`.
 */
export async function GET(req: Request) {
  return NextResponse.json(
    {
      realIp: req.headers.get("x-real-ip"),
      vercelFwd: req.headers.get("x-vercel-forwarded-for"),
      xff: req.headers.get("x-forwarded-for"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
