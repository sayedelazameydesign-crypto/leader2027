import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import type { Repos } from "@/lib/repositories/interfaces";
import { POST as mcpPost, GET as mcpGet } from "@/app/api/mcp/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function mcpReq(
  body: unknown,
  headers: Record<string, string>,
  sessionId?: string,
) {
  return new Request("http://test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let repos: Repos;
beforeEach(() => {
  repos = createMemoryRepos(seededStore());
  setRepos(repos);
});
afterEach(() => setRepos(null));

describe("api-mcp: بوابة الوكلاء (VS5/V5.1)", () => {
  it("401 بلا جلسة — لا كشف الكتالوج لغير المصادق", async () => {
    const res = await mcpPost(mcpReq({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}));
    expect(res.status).toBe(401);
  });

  it("GET ⇒ 405 — السطح POST/JSON-RPC فقط", async () => {
    const res = await mcpGet();
    expect(res.status).toBe(405);
  });

  it("initialize ⇒ serverInfo + ترويسة Mcp-Session-Id (AC1)", async () => {
    const res = await mcpPost(
      mcpReq(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        cookieFor("user-viewer"),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("leader2027-agent-gateway");
    expect(body.result.capabilities.tools).toEqual({ listChanged: false });
    expect(body.result.instructions).toContain("§5");
  });

  it("tools/list ⇒ كل الأدوات المُعلَنة مع وسم الكتابة (AC2)", async () => {
    const res = await mcpPost(
      mcpReq({ jsonrpc: "2.0", id: 2, method: "tools/list" }, cookieFor("user-viewer")),
    );
    const body = await res.json();
    const tools = body.result.tools as Array<{
      name: string;
      inputSchema: unknown;
      annotations: { readOnlyHint: boolean; requiresApproval: boolean };
    }>;
    expect(tools).toHaveLength(27);
    const create = tools.find((t) => t.name === "people.create")!;
    expect(create.annotations.requiresApproval).toBe(true);
    expect(create.annotations.readOnlyHint).toBe(false);
    const list = tools.find((t) => t.name === "people.list")!;
    expect(list.annotations.readOnlyHint).toBe(true);
    expect(list.inputSchema).toMatchObject({ type: "object" });
  });

  it("tools/call قراءة ⇒ يُنفَّذ بسلطة الجلسة (AC3)", async () => {
    const res = await mcpPost(
      mcpReq(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "people.list", arguments: {} },
        },
        { ...cookieFor("user-viewer"), "x-l27-agent": "manus-demo" },
      ),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.tool).toBe("people.list");
    expect(Array.isArray(body.result.structuredContent.value.items)).toBe(true);
    expect(body.result.structuredContent.value.count).toBeGreaterThan(0);
  });

  it("tools/call كتابة ⇒ رفض قبل التنفيذ + تدقيق mcp.write.denied (AC4)", async () => {
    const before = repos.people.list().length;
    const res = await mcpPost(
      mcpReq(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "people.create",
            arguments: { full_name: "محاولة وكيل", source: "ميداني", persuasion: 9 },
          },
        },
        { ...cookieFor("user-viewer"), "x-l27-agent": "manus-demo" },
        "mcp-session-write",
      ),
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.status).toBe("denied");
    expect(body.result.structuredContent.requires_human_approval).toBe(true);
    // لا تنفيذ — حتى لا طلب موافقة: الأشخاص كما كانوا
    expect(repos.people.list()).toHaveLength(before);

    const denied = repos.audit
      .list()
      .filter((e) => e.action === "mcp.write.denied" && e.entity_id === "mcp-session-write");
    expect(denied).toHaveLength(1);
    expect(denied[0].meta?.tool).toBe("people.create");
    expect(denied[0].actor_id).toBe("agent:manus-demo");
  });

  it("Replay: الجلسة تُعاد بناؤها من التدقيق وحده (AC5)", async () => {
    const session = "mcp-replay-1";
    const headers = { ...cookieFor("user-viewer"), "x-l27-agent": "replayer" };
    // خطوة 1: قراءة ناجحة · خطوة 2: كتابة مرفوضة · خطوة 3: قراءة بأداة مجهولة (خطأ)
    await mcpPost(
      mcpReq({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "people.list" } }, headers, session),
    );
    await mcpPost(
      mcpReq(
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "volunteers.create", arguments: {} } },
        headers,
        session,
      ),
    );
    await mcpPost(
      mcpReq({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope.nope" } }, headers, session),
    );

    const timeline = repos.audit
      .list()
      .filter((e) => e.entity_type === "mcp_session" && e.entity_id === session)
      .map((e) => ({ action: e.action, tool: e.meta?.tool, outcome: e.meta?.outcome }));

    expect(timeline.map((t) => t.tool)).toEqual(["people.list", "volunteers.create"]);
    expect(timeline[0]).toMatchObject({ action: "mcp.call", outcome: "ok" });
    expect(timeline[1]).toMatchObject({ action: "mcp.write.denied", outcome: "denied" });
  });

  it("إشعار بلا id ⇒ 202 بلا محتوى (AC6)", async () => {
    const res = await mcpPost(
      mcpReq({ jsonrpc: "2.0", method: "notifications/initialized" }, cookieFor("user-viewer")),
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("JSON غير صالح ⇒ -32700 · أداة مجهولة ⇒ -32602 (AC6)", async () => {
    const bad = await mcpPost(mcpReq("{not json", cookieFor("user-viewer")));
    expect((await bad.json()).error.code).toBe(-32700);

    const unknownTool = await mcpPost(
      mcpReq(
        { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "ghost.tool" } },
        cookieFor("user-viewer"),
      ),
    );
    expect((await unknownTool.json()).error.code).toBe(-32602);
  });
});
