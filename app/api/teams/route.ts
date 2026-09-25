import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { getSettings, createTeam } from "@/lib/domain/settings/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const result = getSettings(actor, repos);
  return result.ok
    ? NextResponse.json({ teams: result.value.teams })
    : failResponse(result);
}

export async function POST(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = createTeam(actor, body, repos);
  return result.ok
    ? NextResponse.json({ team: result.value }, { status: 201 })
    : failResponse(result);
}
