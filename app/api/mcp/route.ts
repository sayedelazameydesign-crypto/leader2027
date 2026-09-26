/**
 * `/api/mcp` — بوابة الوكلاء (VS5/V5.1): سطح MCP للقراءة.
 *
 * POST: جسم JSON-RPC 2.0 (مفرد أو دفعة) — `initialize` · `ping` · `tools/list` · `tools/call`.
 * GET/أخرى: 405. الإشعارات (بلا id) ⇒ 202 بلا محتوى.
 *
 * المصادقة: جلسة بشرية مصادقًا عليها (نفس حدود الـAPI) — الهوية الوكيلية اختيارية
 * عبر `x-l27-agent` (توثيق لا سلطة). الكتابة مرفوضة قبل التنفيذ + موثّقة في التدقيق.
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { handleMcpPayload, resolveSessionId } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON غير صالح" } },
      { status: 400 },
    );
  }

  const sessionId = resolveSessionId(req.headers.get("mcp-session-id"));
  const agentName = (req.headers.get("x-l27-agent") ?? "").trim().slice(0, 40) || null;

  const body = await handleMcpPayload(payload, {
    repos,
    user: { id: user.id, role: user.role },
    agentName,
    sessionId,
  });

  if (body === null) {
    return new NextResponse(null, {
      status: 202,
      headers: { "Mcp-Session-Id": sessionId },
    });
  }
  return NextResponse.json(body, {
    status: 200,
    headers: { "Mcp-Session-Id": sessionId },
  });
}

export async function GET() {
  return NextResponse.json(
    {
      errors: {
        _method: "استخدم POST بجسم JSON-RPC 2.0 — انظر docs/contract-vs5.md",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
