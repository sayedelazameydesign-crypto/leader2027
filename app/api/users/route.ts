import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { createUser, listUsers } from "@/lib/domain/users/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const result = listUsers(actor, repos);
  return result.ok
    ? NextResponse.json({ users: result.value })
    : failResponse(result);
}

export async function POST(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = createUser(actor, body, repos);
  return result.ok
    ? NextResponse.json({ user: result.value }, { status: 201 })
    : failResponse(result);
}
