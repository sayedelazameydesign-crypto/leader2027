/**
 * `/api/mcp` — بوابة الوكلاء (VS5/V5.1): سطح MCP للقراءة.
 *
 * POST: جسم JSON-RPC 2.0 (مفرد أو دفعة ≤20) — `initialize` · `ping` · `tools/list` · `tools/call`.
 * GET/أخرى: 405. الإشعارات (بلا id) ⇒ 202 بلا محتوى.
 *
 * المصادقة: جلسة بشرية مصادقًا عليها (نفس حدود الـAPI) — الهوية الوكيلية اختيارية
 * عبر `x-l27-agent` (توثيق لا سلطة). الكتابة مرفوضة قبل التنفيذ + موثّقة في التدقيق.
 *
 * الطبقات بالترتيب (مراجعة ما قبل النشر):
 *   1) كبح فيضان خشن (600/دقيقة لكل IP موثوق) + دلو فشل (60/دقيقة) — قبل
 *      المصادقة وبلا استعلام DB. **لا XFF**: الهوية من ترويسة موثوقة واحدة
 *      (`clientIp`) — قابلية تدوير الترويسات مُغلقة كليًا.
 *   2) `requireUserForApi` = فحص الأصل ثم الجلسة (نفس كل المسارات — لا استثناء).
 *   3) مُخدد المستخدم (60/دقيقة) بمفتاح **user.id لا ترويسة يتحكم بها العميل**،
 *      + مُخدد وكيل ثانوي (20/دقيقة) — تغيير `x-l27-agent` لا يرفع السقف.
 *   4) `Cache-Control: no-store` على كل ردود الجلسة.
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { clientIp } from "@/lib/http-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleMcpPayload, resolveSessionId } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const sessionId = resolveSessionId(req.headers.get("mcp-session-id"));
  const headers = { "Mcp-Session-Id": sessionId, ...NO_STORE };
  const ip = clientIp(req);

  // 1) فيضان خشن — سقف عالٍ لا يقيّد العمل الطبيعي خلف NAT؛ ودلو فشل يُستهلك
  //    عند ردود 401/403 فقط: بعد 60 فشلًا/دقيقة تتحول الردود إلى 429.
  if (!(await checkRateLimit(`mcp:ip:${ip}`, 600, 60_000))) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32029, message: "معدل طلبات مرتفع — أعد المحاولة بعد دقيقة" },
      },
      { status: 429, headers },
    );
  }

  // 2) المصادقة + فحص الأصل — نفس حدود كل المسارات.
  // 2.5 دلو الفشل: **يُستهلك عند ردود المصادقة المرفوضة (401/403) فقط** — لا
  //     400 (JSON) ولا 405 ولا 500 تلمسه، والنجاحات لا تلمسه إطلاقًا. التسلسل:
  //     مصادقة → إن فشلت → افحص الدلو → ممتلئ ⇒ 429 وإلا 401 + زيادة.
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) {
    const failuresLeft = await checkRateLimit(`mcp:ip:fail:${ip}`, 60, 60_000);
    if (!failuresLeft) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32029, message: "محاولات فاشلة كثيرة — أعد المحاولة بعد دقيقة" },
        },
        { status: 429, headers },
      );
    }
    user.headers.set("Cache-Control", "no-store");
    return user;
  }

  const agentName = (req.headers.get("x-l27-agent") ?? "").trim().slice(0, 40) || null;

  // 3) المُخدد الدقيق: الأساسي بمعرّف المستخدم (لا الترويسة — منع التجاوز)،
  //    والوكيل حدّ ثانوي أدق تحت سقف المستخدم نفسه.
  if (!(await checkRateLimit(`mcp:user:${user.id}`, 60, 60_000))) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32029, message: "معدل طلبات مرتفع — أعد المحاولة بعد دقيقة" },
      },
      { status: 429, headers },
    );
  }
  if (agentName && !(await checkRateLimit(`mcp:agent:${user.id}:${agentName}`, 20, 60_000))) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32029, message: "معدل طلبات الوكيل مرتفع — أعد المحاولة بعد دقيقة" },
      },
      { status: 429, headers },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON غير صالح" } },
      { status: 400, headers },
    );
  }

  const body = await handleMcpPayload(payload, {
    repos,
    user: { id: user.id, role: user.role },
    agentName,
    sessionId,
  });
  if (body === null) {
    return new NextResponse(null, { status: 202, headers });
  }
  return NextResponse.json(body, { status: 200, headers });
}

export async function GET() {
  return NextResponse.json(
    {
      errors: {
        _method: "استخدم POST بجسم JSON-RPC 2.0 — انظر docs/contract-vs5.md",
      },
    },
    { status: 405, headers: { Allow: "POST", ...NO_STORE } },
  );
}
