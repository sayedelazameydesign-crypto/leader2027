import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { createPerson, listPeople } from "@/lib/domain/people/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  return NextResponse.json({ people: listPeople(actor, repos) });
}

export async function POST(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = createPerson(actor, body, repos);
  return result.ok
    ? NextResponse.json({ person: result.value }, { status: 201 })
    : failResponse(result);
}
