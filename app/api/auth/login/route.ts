import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { publicUser } from "@/lib/auth/request";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const repos = getRepos();
  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

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
      path: "/",
      maxAge: 12 * 3600,
    },
  );
  return res;
}
