import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { getKpis } from "@/lib/domain/dashboard";
import { failResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const actor = requireUserForApi(repos, req);
  if (isResponse(actor)) return actor;
  const result = getKpis(actor, repos);
  return result.ok
    ? NextResponse.json({
        generatedAt: new Date().toISOString(),
        demo: false,
        kpis: result.value,
      })
    : failResponse(result);
}
