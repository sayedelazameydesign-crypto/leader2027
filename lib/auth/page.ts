import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Repos, User } from "@/lib/repositories/interfaces";
import { getRepos } from "@/lib/repositories/container";
import { getSessionUser } from "./request";
import { SESSION_COOKIE } from "./session";

/** حدود المصادقة لصفحات التطبيق — بلا جلسة: تحويل إلى /login. */
export async function requirePageUser(): Promise<{ repos: Repos; user: User }> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  const repos = getRepos();
  const user = getSessionUser(repos, token);
  if (!user) redirect("/login");
  return { repos, user };
}
