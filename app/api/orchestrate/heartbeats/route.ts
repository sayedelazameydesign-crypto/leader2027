/**
 * /api/orchestrate/heartbeats — تجديد الـlease بالنبض (V5.3).
 *
 * POST `{leaseId, instance?}` (tasks:manage) ⇒ 200 `{ok|denied}`
 */
import { NextResponse } from "next/server";
import { heartbeatLease } from "@/lib/orchestrate/service";
import {
  asNonEmptyString,
  badRequest,
  guardRoute,
  isRecord,
  mapKnownError,
  readJsonBody,
} from "@/lib/orchestrate/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = guardRoute(req, "tasks:manage");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  if (!isRecord(parsed.body)) return badRequest("_form", "جسم الطلب كائن مطلوب");
  const leaseId = asNonEmptyString(parsed.body.leaseId);
  if (!leaseId) return badRequest("leaseId", "معرّف الـlease مطلوب");
  const instance = parsed.body.instance;
  if (instance !== undefined && typeof instance !== "string") {
    return badRequest("instance", "لاحقة العامل نص");
  }
  try {
    return NextResponse.json(heartbeatLease(ctx.repos, ctx.userId, { leaseId, instance }));
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }
}
