import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { getVolunteer, updateVolunteer } from "@/lib/domain/volunteers/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const result = getVolunteer(actor, id, repos);
  return result.ok
    ? NextResponse.json({ volunteer: result.value })
    : failResponse(result);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = updateVolunteer(actor, id, body, repos);
  return result.ok
    ? NextResponse.json({ volunteer: result.value })
    : failResponse(result);
}
