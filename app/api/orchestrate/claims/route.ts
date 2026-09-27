/**
 * /api/orchestrate/claims — المطالبة بملكية التنفيذ (V5.3).
 *
 * POST `{taskId, instance?}` (tasks:manage) ⇒ 200 `{claimed|denied}`
 */
import { NextResponse } from "next/server";
import { claimTask } from "@/lib/orchestrate/service";
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
  const taskId = asNonEmptyString(parsed.body.taskId);
  if (!taskId) return badRequest("taskId", "معرّف المهمة مطلوب");
  const instance = parsed.body.instance;
  if (instance !== undefined && typeof instance !== "string") {
    return badRequest("instance", "لاحقة العامل نص");
  }
  try {
    return NextResponse.json(claimTask(ctx.repos, ctx.userId, { taskId, instance }));
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }
}
