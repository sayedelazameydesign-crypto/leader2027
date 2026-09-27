/**
 * /api/tasks/approvals/:id — القرار البشري على موافقة معلَّقة (GEN-3).
 *
 * POST `{decision: "approved"|"rejected", alternativesAvailable?}` (users:manage — Manager+)
 *   اعتماد ⇒ Grant أحادي (تبقى WAITING_APPROVAL حتى resume)
 *   رفض ⇒ fail-closed (REPLANNING ببديل وإلا BLOCKED)
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
  if (!can(user, "users:manage")) {
    return failResponse(fail(403, { _auth: "قرارات الموافقة تتطلب users:manage" }));
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failResponse(fail(400, { _form: "JSON غير صالح" }));
  }
  const input = (body ?? {}) as { decision?: unknown; alternativesAvailable?: unknown };
  if (input.decision !== "approved" && input.decision !== "rejected") {
    return failResponse(fail(400, { decision: "القرار approved أو rejected فقط" }));
  }
  try {
    const engine = new TaskEngine(repos);
    const by: TaskActor = { id: user.id, kind: "human", role: user.role as TaskActor["role"] };
    const { task, approval, grant } = engine.decideApproval(id, {
      decision: input.decision,
      by,
      alternativesAvailable: input.alternativesAvailable === true,
    });
    return NextResponse.json({ approval, task, grant }, { status: 200 });
  } catch (err) {
    if (err instanceof TaskEngineError) {
      return NextResponse.json(taskErrorBody(err), { status: taskErrorStatus(err) });
    }
    throw err;
  }
}
