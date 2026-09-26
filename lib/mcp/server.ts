/**
 * بوابة الوكلاء — سطح MCP للقراءة (VS5/V5.1).
 *
 * منطق JSON-RPC 2.0 مصغَّر على أسلوب Streamable HTTP:
 *   `initialize` · `ping` · `tools/list` · `tools/call` · إشعارات (بلا id) ⇒ 202.
 *
 * القواعد المثبَّتة (عقد VS5):
 *   - القراءة تُنفَّذ **بسلطة الجلسة البشرية** المصادق عليها (تفويض لا تصعيد).
 *   - الكتابة **مرفوضة قبل التنفيذ** — لا kernel.execute ولا حتى طلب موافقة (V5.2).
 *   - كل `tools/call` يُسجَّل في التدقيق بمعرّف الجلسة — Replay = إعادة البناء من التدقيق وحده.
 *   - §5 ممتدة للوكلاء: لا payload للكتابة يمرّ أصلًا، وحقول التفضيل السياسي مرفوضة في المجال.
 */
import { randomUUID } from "node:crypto";
import type { Repos } from "@/lib/repositories/interfaces";
import type { Role } from "@/lib/authorization/roles";
import type { Actor, ToolDescriptor } from "@/lib/kernel/types";
import { getKernel } from "@/lib/kernel/registry";
import { recordAudit } from "@/lib/audit/audit";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = {
  name: "leader2027-agent-gateway",
  title: "بوابة الوكلاء — Leader 2027",
  version: "0.1.0",
};
export const MCP_INSTRUCTIONS =
  "القراءة مسموحة بصلاحية الجلسة المصادق عليها. الكتابة مرفوضة على هذا السطح (V5.1) — " +
  "أي محاولة كتابة تُسجَّل في التدقيق وتُرفض. §5: لا انتماء سياسي ولا درجة إقناع — إطلاقًا.";

export type JsonRpcId = string | number | null;

export type McpContext = {
  repos: Repos;
  /** فاعل الجلسة — سلطته هي سلطة التنفيذ (تفويض لا تصعيد). */
  user: { id: string; role: Role };
  /** اسم الوكيل من ترويسة `x-l27-agent` — للتوثيق فقط، لا سلطة تُضاف. */
  agentName: string | null;
  sessionId: string;
};

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function isNotification(msg: JsonRpcMessage): boolean {
  return !("id" in msg) || msg.id === undefined;
}

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** مخطط JSON مُشتق من `ToolDescriptor.input` (اسم الحقل → نوعه). */
export function inputSchema(tool: ToolDescriptor): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [field, type] of Object.entries(tool.input)) {
    const t = type === "number" ? "number" : type === "boolean" ? "boolean" : "string";
    properties[field] = { type: t };
  }
  return { type: "object", properties, additionalProperties: false };
}

/** أداة كتابة؟ معيار النواة نفسه: مخاطرة ≥ write أو إلزام الموافقة للوكلاء. */
export function isWriteTool(tool: ToolDescriptor): boolean {
  return tool.requiresApprovalForAgents || tool.risk === "write" || tool.risk === "admin";
}

function logCall(
  ctx: McpContext,
  action: "mcp.call" | "mcp.write.denied",
  tool: string,
  kind: "read" | "write",
  outcome: "ok" | "denied" | "error",
): void {
  recordAudit(
    ctx.repos,
    { id: ctx.agentName ? `agent:${ctx.agentName}` : ctx.user.id, role: ctx.user.role },
    action,
    "mcp_session",
    ctx.sessionId,
    {
      tool,
      kind,
      outcome,
      agent: ctx.agentName ?? "—",
      via: ctx.user.id,
    },
  );
}

/** يعالج جسم JSON-RPC (مفرد أو دفعة) ويعيد استجابة مفردة أو دفعة أو `null` (إشعار). */
export async function handleMcpPayload(
  payload: unknown,
  ctx: McpContext,
): Promise<unknown | null> {
  if (Array.isArray(payload)) {
    const responses = [];
    for (const item of payload) {
      const res = await handleOne(item, ctx);
      if (res !== null) responses.push(res);
    }
    return responses.length > 0 ? responses : null;
  }
  return handleOne(payload, ctx);
}

async function handleOne(payload: unknown, ctx: McpContext): Promise<unknown | null> {
  if (typeof payload !== "object" || payload === null) {
    return error(null, -32600, "طلب JSON-RPC غير صالح");
  }
  const msg = payload as JsonRpcMessage;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return error((msg.id as JsonRpcId) ?? null, -32600, "طلب JSON-RPC غير صالح");
  }
  const id = (msg.id ?? null) as JsonRpcId;
  const params = (typeof msg.params === "object" && msg.params !== null ? msg.params : {}) as Record<
    string,
    unknown
  >;

  switch (msg.method) {
    case "initialize":
      return result(id, {
        protocolVersion:
          typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });

    case "ping":
      return result(id, {});

    case "tools/list": {
      const boot = await getKernel();
      return result(id, {
        tools: boot.kernel.tools().map((tool) => ({
          name: tool.name,
          description: `${tool.label.ar} / ${tool.label.en} — ${
            isWriteTool(tool) ? "كتابة: تتطلب موافقة بشرية (مرفوضة على هذا السطح)" : "قراءة"
          }`,
          inputSchema: inputSchema(tool),
          annotations: {
            readOnlyHint: !isWriteTool(tool),
            requiresApproval: tool.requiresApprovalForAgents,
          },
        })),
      });
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (
        typeof params.arguments === "object" && params.arguments !== null
          ? params.arguments
          : {}
      ) as Record<string, unknown>;

      const boot = await getKernel();
      const tool = boot.kernel.tools().find((t) => t.name === name);
      if (!tool) {
        if (isNotification(msg)) return null;
        return error(id, -32602, `أداة غير معروفة: ${name}`);
      }

      // V5.1: الكتابة مرفوضة قبل التنفيذ — لا kernel.execute ولا طلب موافقة.
      if (isWriteTool(tool)) {
        logCall(ctx, "mcp.write.denied", name, "write", "denied");
        if (isNotification(msg)) return null;
        return result(id, {
          content: [
            {
              type: "text",
              text: `الكتابة عبر بوابة الوكلاء مرفوضة في V5.1 — أداة "${name}" تتطلب موافقة بشرية عبر /api/kernel/actions (V5.2).`,
            },
          ],
          structuredContent: {
            status: "denied",
            requires_human_approval: true,
            approval_surface: "POST /api/kernel/actions",
            tool: name,
          },
          isError: true,
        });
      }

      // القراءة: تنفيذ بسلطة الجلسة (تفويض لا تصعيد) — الهوية الوكيلية موثّقة.
      const outcome = await boot.kernel.execute(name, args, {
        actor: { id: ctx.user.id, role: ctx.user.role, kind: "human" } as Actor,
      });

      const ok = outcome.status === "ok";
      logCall(ctx, "mcp.call", name, "read", ok ? "ok" : "error");
      if (isNotification(msg)) return null;

      if (ok) {
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(outcome.value) }],
          structuredContent: { tool: outcome.tool, cell: outcome.cell, value: outcome.value },
          isError: false,
        });
      }
      const message =
        outcome.status === "error"
          ? outcome.message
          : outcome.status === "denied"
            ? outcome.reason
            : `حالة غير متوقعة: ${outcome.status}`;
      return result(id, {
        content: [{ type: "text", text: message }],
        structuredContent: { status: outcome.status, tool: name },
        isError: true,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    default:
      if (isNotification(msg)) return null;
      return error(id, -32601, `طريقة غير معروفة: ${msg.method}`);
  }
}

/** معرّف جلسة: من العميل أو مُولَّد — يُعاد في ترويسة `Mcp-Session-Id`. */
export function resolveSessionId(header: string | null): string {
  const clean = (header ?? "").trim();
  if (clean && clean.length <= 80) return clean;
  return `mcp-${randomUUID()}`;
}
