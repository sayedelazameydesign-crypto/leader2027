import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { createReport, listReports } from "@/lib/domain/field/service";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const url = new URL(req.url);
  const filter = {
    team_id: url.searchParams.get("team_id") ?? undefined,
    region_id: url.searchParams.get("region_id") ?? undefined,
  };
  return NextResponse.json({ reports: listReports(actor, repos, filter) });
}

export async function POST(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const body = await req.json().catch(() => null);
  const result = createReport(actor, body, repos);
  return result.ok
    ? NextResponse.json({ report: result.value }, { status: 201 })
    : failResponse(result);
}
