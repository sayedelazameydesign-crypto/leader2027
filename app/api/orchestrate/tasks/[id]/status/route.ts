/**
 * /api/orchestrate/tasks/:id/status — لقطة حالة للاستطلاع (V5.3).
 *
 * GET (tasks:view) ⇒ 200 `{task, lease, progress}` · مهمة مجهولة ⇒ 404.
 */
import { NextResponse } from "next/server";
import { getTaskStatus } from "@/lib/orchestrate/service";
import { guardRoute } from "@/lib/orchestrate/http";
import { failResponse } from "@/lib/http";
import { fail } from "@/lib/validation/result";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = guardRoute(req, "tasks:view");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const view = getTaskStatus(ctx.repos, id);
  if (!view) {
    return failResponse(fail(404, { task: "مهمة غير موجودة" }));
  }
  return NextResponse.json(view);
}
