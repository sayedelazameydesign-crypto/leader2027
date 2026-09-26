import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http-guards";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
