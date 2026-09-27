/**
 * /api/tasks/:id/resume — الاستئناف بمنح (GEN-3).
 *
 * POST `{approvalId, operation, costCap, proposal}` (tasks:manage)
 *   يعيد تحقق الثلاثية قبل READY (R2) ⇒ 200 `{task}`
 *   عدم تطابق/استهلاك مسبق ⇒ 403 DENY بلا انتقال
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { can } from "@/lib/authorization/policy";
import { failResponse } from "@/lib/http";
import { fail } from "@/lib/validation/result";
import { TaskEngine } from "@/lib/tasks/engine";
import { TaskEngineError, type TaskActor } from "@/lib/tasks/types";
import { taskErrorBody, taskErrorStatus } from "@/lib/tasks/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;
  if (!can(user, "tasks:manage")) {
    return failResponse(fail(403, { _auth: "الاستئناف يتطلب tasks:manage" }));
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failResponse(fail(400, { _form: "JSON غير صالح" }));
  }
  const input = (body ?? {}) as {
    approvalId?: unknown;
    operation?: unknown;
    costCap?: unknown;
    proposal?: unknown;
    alternativesAvailable?: unknown;
  };
  if (typeof input.approvalId !== "string" || !input.approvalId.trim()) {
    return failResponse(fail(400, { approvalId: "معرّف الموافقة مطلوب" }));
  }
  if (typeof input.operation !== "string" || !input.operation.trim()) {
    return failResponse(fail(400, { operation: "اسم العملية مطلوب" }));
  }
  if (typeof input.costCap !== "number") {
    return failResponse(fail(400, { costCap: "سقف التكلفة رقم مطلوب" }));
  }
  if (!input.proposal || typeof input.proposal !== "object" || Array.isArray(input.proposal)) {
    return failResponse(fail(400, { proposal: "المقترح كائن قانوني مطلوب" }));
  }
  try {
    const engine = new TaskEngine(repos);
    const actor: TaskActor = { id: user.id, kind: "human", role: user.role as TaskActor["role"] };
    const task = engine.resume(
      id,
      {
        approvalId: input.approvalId,
        operation: input.operation,
        costCap: input.costCap,
        proposal: input.proposal as Record<string, unknown>,
        alternativesAvailable: input.alternativesAvailable === true,
      },
      actor,
    );
    return NextResponse.json({ task }, { status: 200 });
  } catch (err) {
    if (err instanceof TaskEngineError) {
      return NextResponse.json(taskErrorBody(err), { status: taskErrorStatus(err) });
    }
    throw err;
  }
}
