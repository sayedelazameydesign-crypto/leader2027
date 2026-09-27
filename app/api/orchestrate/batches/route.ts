/**
 * /api/orchestrate/batches — دفعة تنفيذية مرتّبة (V5.3).
 *
 * POST `{taskId, instance?, items:[...]}` (1–25 بندًا) (tasks:manage)
 *   ⇒ 200 `{completed, applied, outcomes, task}` — توقف عند أول رفض (D6).
 */
import { NextResponse } from "next/server";
import { MAX_BATCH_ITEMS, executeBatchFree, type StepRequest } from "@/lib/orchestrate/service";
import {
  asNonEmptyString,
  badRequest,
  guardRoute,
  isRecord,
  mapKnownError,
  readJsonBody,
} from "@/lib/orchestrate/http";
import { parseStepBody } from "../steps/route";

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
  const items = parsed.body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return badRequest("items", "الدفعة قائمة بنود غير فارغة (1–25)");
  }
  if (items.length > MAX_BATCH_ITEMS) {
    return badRequest("items", `الدفعة بحد أقصى ${MAX_BATCH_ITEMS} بندًا`);
  }
  const requests: StepRequest[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const step = parseStepBody(items[i]);
    if (!step.ok) return badRequest(`items[${i}].${step.field}`, step.message);
    requests.push({ taskId, instance, ...step.value });
  }
  try {
    return NextResponse.json(
      executeBatchFree(ctx.repos, ctx.userId, { taskId, instance, items: requests }),
    );
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }
}
