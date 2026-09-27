/**
 * /api/tasks/:id — تفاصيل مهمة دائمة (GEN-3): الحالة + checkpoints + الموافقات
 * + المنح + artifacts + سلامة السلسلة (tasks:view).
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { can } from "@/lib/authorization/policy";
import { failResponse } from "@/lib/http";
import { fail } from "@/lib/validation/result";
import { TaskEngine } from "@/lib/tasks/engine";
import { TaskEngineError } from "@/lib/tasks/types";
import { taskErrorBody, taskErrorStatus } from "@/lib/tasks/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;
  if (!can(user, "tasks:view")) {
    return failResponse(fail(403, { _auth: "قراءة المهام تتطلب tasks:view" }));
  }
  const { id } = await params;
  try {
    const engine = new TaskEngine(repos);
    const task = engine.getTask(id);
    if (!task) return failResponse(fail(404, { task: "مهمة غير موجودة" }));
    return NextResponse.json({
      task,
      checkpoints: engine.checkpoints(id),
      approvals: engine.approvals(id),
      grants: engine.grants(id),
      artifacts: engine.artifacts(id),
      chainValid: engine.verifyChain(id),
    });
  } catch (err) {
    if (err instanceof TaskEngineError) {
      return NextResponse.json(taskErrorBody(err), { status: taskErrorStatus(err) });
    }
    throw err;
  }
}
