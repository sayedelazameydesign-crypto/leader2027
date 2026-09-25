import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { createVolunteer, listVolunteers } from "@/lib/domain/volunteers/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const url = new URL(req.url);
  const filter = {
    team_id: url.searchParams.get("team_id") ?? undefined,
    person_id: url.searchParams.get("person_id") ?? undefined,
  };
  return NextResponse.json({ volunteers: listVolunteers(actor, repos, filter) });
}

export async function POST(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = createVolunteer(actor, body, repos);
  return result.ok
    ? NextResponse.json({ volunteer: result.value }, { status: 201 })
    : failResponse(result);
}
