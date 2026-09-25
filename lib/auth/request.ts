import { NextResponse } from "next/server";
import type { Repos, User } from "@/lib/repositories/interfaces";
import { readSessionToken, SESSION_COOKIE } from "./session";

export function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function getSessionUser(repos: Repos, token: string | null): User | null {
  if (!token) return null;
  const payload = readSessionToken(token);
  if (!payload) return null;
  const user = repos.users.getById(payload.uid);
  if (!user) return null;
  // VS3 — تقوية الجلسات: epoch غير مطابق = جلسة مُبطَلة (تغيّر الدور مثلاً)
  if (payload.ep !== user.session_epoch) return null;
  return user;
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** شكل المستخدم الآمن للخارج — لا password_hash إطلاقاً. */
export function publicUser(user: User): Omit<User, "password_hash"> {
  const { password_hash: _drop, ...safe } = user;
  void _drop;
  return safe;
}

/** حدود المصادقة على مستوى الـAPI — 401 قبل أي منطق. */
export function requireUserForApi(repos: Repos, req: Request): User | NextResponse {
  const user = getSessionUser(repos, tokenFromCookieHeader(req.headers.get("cookie")));
  if (!user) {
    return NextResponse.json(
      { errors: { _auth: "المصادقة مطلوبة" } },
      { status: 401 },
    );
  }
  return user;
}
