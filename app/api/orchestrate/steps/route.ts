/**
 * /api/orchestrate/steps — تنفيذ خطوة مجانية واحدة (V5.3).
 *
 * POST `{taskId, stepId, instance?, verdict, observation?, evidence?, artifact?}`
 *   (tasks:manage) ⇒ 200 `{ok|already-verified|skipped-duplicate|denied}`
 *   المدفوع ⇒ `denied orchestrate.paid_not_wired` (D3 — بلا أي أثر).
 */
import { NextResponse } from "next/server";
import { executeStepFree, type StepRequest } from "@/lib/orchestrate/service";
import {
  asNonEmptyString,
  badRequest,
  guardRoute,
  isRecord,
  mapKnownError,
  readJsonBody,
} from "@/lib/orchestrate/http";

export const dynamic = "force-dynamic";

export function parseStepBody(
  body: unknown,
): { ok: true; value: Omit<StepRequest, "taskId" | "instance"> & { stepId: string } } | { ok: false; field: string; message: string } {
  if (!isRecord(body)) return { ok: false, field: "_form", message: "جسم الطلب كائن مطلوب" };
  const stepId = asNonEmptyString(body.stepId);
  if (!stepId) return { ok: false, field: "stepId", message: "معرّف الخطوة مطلوب" };
  if (body.verdict !== "verified" && body.verdict !== "failed") {
    return { ok: false, field: "verdict", message: "الحكم: verified أو failed (صريح دائمًا)" };
  }
  if (body.observation !== undefined && !isRecord(body.observation)) {
    return { ok: false, field: "observation", message: "الملاحظة كائن" };
  }
  const artifact = body.artifact;
  if (artifact !== undefined) {
    if (!isRecord(artifact)) return { ok: false, field: "artifact", message: "الأثر {type, ref}" };
    if (!asNonEmptyString(artifact.type) || !asNonEmptyString(artifact.ref)) {
      return { ok: false, field: "artifact", message: "الأثر يتطلب type وref نصين" };
    }
  }
  return {
    ok: true,
    value: {
      stepId,
      verdict: body.verdict,
      observation: body.observation as Record<string, unknown> | undefined,
      evidence: body.evidence,
      artifact: artifact as { type: string; ref: string } | undefined,
    },
  };
}

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
  const step = parseStepBody(parsed.body);
  if (!step.ok) return badRequest(step.field, step.message);
  try {
    return NextResponse.json(
      executeStepFree(ctx.repos, ctx.userId, { taskId, instance, ...step.value }),
    );
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }
}
