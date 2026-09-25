import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { getSettings, updateCampaign } from "@/lib/domain/settings/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const result = getSettings(actor, repos);
  return result.ok
    ? NextResponse.json({ campaign: result.value.campaign })
    : failResponse(result);
}

export async function PATCH(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = updateCampaign(actor, body, repos);
  return result.ok
    ? NextResponse.json({ campaign: result.value })
    : failResponse(result);
}
