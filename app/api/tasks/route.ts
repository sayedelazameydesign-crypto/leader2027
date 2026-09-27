/**
 * /api/tasks — المهام الدائمة (GEN-3).
 *
 * GET  → قائمة المهام (tasks:view)
 * POST → إنشاء مهمة `{goal}` (tasks:manage) ⇒ 201
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

function actorOf(user: { id: string; role: string }): TaskActor {
  return { id: user.id, kind: "human", role: user.role as TaskActor["role"] };
}

export async function GET(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;
  if (!can(user, "tasks:view")) {
    return failResponse(fail(403, { _auth: "قراءة المهام تتطلب tasks:view" }));
  }
  const engine = new TaskEngine(repos);
  const tasks = engine.listTasks().map((t) => ({
    id: t.id,
    goal: t.goal,
    status: t.status,
    steps: t.plan.length,
    checkpointHead: t.checkpointHead,
    evidenceChainHead: t.evidenceChainHead,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;
  if (!can(user, "tasks:manage")) {
    return failResponse(fail(403, { _auth: "إنشاء المهام يتطلب tasks:manage" }));
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failResponse(fail(400, { _form: "JSON غير صالح" }));
  }
  const goal = (body as { goal?: unknown })?.goal;
  if (typeof goal !== "string" || !goal.trim()) {
    return failResponse(fail(400, { goal: "هدف المهمة مطلوب" }));
  }
  try {
    const engine = new TaskEngine(repos);
    const task = engine.createTask(goal, actorOf(user));
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof TaskEngineError) {
      return NextResponse.json(taskErrorBody(err), { status: taskErrorStatus(err) });
    }
    throw err;
  }
}
