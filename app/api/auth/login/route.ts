import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { publicUser } from "@/lib/auth/request";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { assertSameOrigin, clientIp } from "@/lib/http-guards";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // CSRF: Origin أجنبي على POST ⇒ 403 (SameSite=Lax يكمل من ناحية الكوكي).
  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  // مُخدد التخمين: 10 محاولات/دقيقة لكل (IP × بريد) — كبح للتخمين brute-force.
  // الهوية من ترويسة موثوقة (`clientIp`) — لا XFF (أيسر عنصر يتحكم فيه العميل).
  const ip = clientIp(req);
  if (!(await checkRateLimit(`login:${ip}:${email}`, 10, 60_000))) {
    return NextResponse.json(
      { errors: { _auth: "محاولات دخول كثيرة — أعد المحاولة بعد دقيقة" } },
      { status: 429 },
    );
  }

  const repos = getRepos();
  const user = email && password ? repos.users.getByEmail(email) : null;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json(
      { errors: { _auth: "بيانات دخول غير صحيحة" } },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, user.session_epoch ?? 0),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 3600,
    },
  );
  return res;
}
