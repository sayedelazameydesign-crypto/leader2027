/**
 * /api/kernel/actions — تنفيذ أدوات الأنوية وقرارات الموافقة.
 *
 * POST body:
 *   { action: "tool",     tool: "<cell>.<tool>", input: {...}, approval_id?: "apr-…" }
 *   { action: "grant",    approval_id: "apr-…", note?: "…" }
 *   { action: "deny",     approval_id: "apr-…", reason: "…" }
 *
 * كل قرار موافقة يتطلب `users:manage` — منحها أو منعها ليست عملية عادية.
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { can } from "@/lib/authorization/policy";
import { failResponse } from "@/lib/http";
import { getKernel } from "@/lib/kernel/registry";
import { fail } from "@/lib/validation/result";
import type { Actor } from "@/lib/kernel/types";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string }): Actor {
  return { id: user.id, role: user.role, kind: "human" };
}

/**
 * هوية الوكيل — **تفويض صريح لا تصعيد صلاحيات**.
 *
 * حين يرسل العميل ترويسة `x-l27-agent` تُعالَج العملية كطلب وكيل: الجلسة البشرية
 * تبقى شرطًا (لا وصول بلا مصادقة)، لكن أدوات الكتابة تُعلَّق حتى موافقة بشرية.
 * أي أن الترويسة **تُقلّص** سلطة الطالب ولا تزيدها أبدًا.
 */
function actorFor(req: Request, user: { id: string; role: string }): Actor {
  const agentName = (req.headers.get("x-l27-agent") ?? "").trim();
  if (!agentName) return actorFrom(user);
  return {
    id: `agent:${agentName.slice(0, 40)}`,
    role: "AGENT",
    kind: "agent",
  };
}

export async function POST(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failResponse(fail(400, { _form: "JSON غير صالح" }));
  }

  const input = (body ?? {}) as {
    action?: unknown;
    tool?: unknown;
    input?: unknown;
    approval_id?: unknown;
    note?: unknown;
    reason?: unknown;
  };

  const boot = await getKernel();
  const actor = actorFor(req, user);

  if (input.action === "tool") {
    const tool = typeof input.tool === "string" ? input.tool : "";
    if (!tool) return failResponse(fail(400, { tool: "اسم الأداة مطلوب" }));

    const outcome = await boot.kernel.execute(
      tool,
      (typeof input.input === "object" && input.input !== null ? input.input : {}) as Record<string, unknown>,
      {
        actor,
        approvalId: typeof input.approval_id === "string" ? input.approval_id : undefined,
      },
    );

    const status = {
      ok: 200,
      pending_approval: 202,
      denied: 403,
      error: 400,
    }[outcome.status];

    return NextResponse.json(outcome, { status });
  }

  if (input.action === "grant" || input.action === "deny") {
    if (!can(user, "users:manage")) {
      return failResponse(fail(403, { _auth: "قرارات الموافقة تتطلب users:manage" }));
    }
    const approvalId = typeof input.approval_id === "string" ? input.approval_id : "";
    if (!approvalId) return failResponse(fail(400, { approval_id: "معرّف الطلب مطلوب" }));

    if (!boot.kernel.approvals.get(approvalId)) {
      return failResponse(fail(404, { approval_id: "طلب غير موجود" }));
    }

    /**
     * القرار يمرّ عبر **أداة النواة** لا عبر البوابة مباشرة:
     * مسار واحد للقرارات ⇒ أثر تدقيقي واحد مضمون (`ai.approval.granted/denied`)
     * وفحص صلاحية عند حدود القدرة، لا في طبقة الـHTTP وحدها.
     */
    const outcome = await boot.kernel.execute(
      input.action === "grant" ? "ai.grant_approval" : "ai.deny_approval",
      input.action === "grant"
        ? { approval_id: approvalId, ...(typeof input.note === "string" ? { note: input.note } : {}) }
        : { approval_id: approvalId, reason: typeof input.reason === "string" ? input.reason : "بلا سبب" },
      { actor },
    );

    if (outcome.status !== "ok") {
      return NextResponse.json(outcome, { status: outcome.status === "denied" ? 403 : 400 });
    }
    return NextResponse.json({ approval: outcome.value });
  }

  return failResponse(fail(400, { action: "إجراء غير معروف — المتوقع tool/grant/deny" }));
}
