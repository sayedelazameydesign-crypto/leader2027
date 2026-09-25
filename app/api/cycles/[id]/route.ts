import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { updateCycle } from "@/lib/domain/settings/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = updateCycle(actor, id, body, repos);
  return result.ok
    ? NextResponse.json({ cycle: result.value })
    : failResponse(result);
}
