import { describe, it, expect } from "vitest";
import {
  inputSchema,
  isWriteTool,
  resolveSessionId,
  handleMcpPayload,
  MCP_SERVER_INFO,
  type McpContext,
} from "@/lib/mcp/server";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import type { ToolDescriptor } from "@/lib/kernel/types";

function tool(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    name: "people.create",
    label: { ar: "إنشاء شخص", en: "Create person" },
    capability: "people.write",
    risk: "write",
    input: { full_name: "string", age: "number", active: "boolean" },
    requiresApprovalForAgents: true,
    ...overrides,
  };
}

function ctx(): McpContext {
  return {
    repos: createMemoryRepos(seededStore()),
    user: { id: "user-viewer", role: "VIEWER" },
    agentName: "unit-agent",
    sessionId: "mcp-unit",
  };
}

describe("mcp: الدوال النقية (VS5/V5.1)", () => {
  it("inputSchema يُشتق الأنواع من المخطط المُعلن", () => {
    const schema = inputSchema(tool());
    const properties = schema.properties as Record<string, { type: string }>;
    expect(properties.full_name.type).toBe("string");
    expect(properties.age.type).toBe("number");
    expect(properties.active.type).toBe("boolean");
    expect(schema.additionalProperties).toBe(false);
  });

  it("isWriteTool: الكتابة والإدارية تُعدّ كتابة — القراءة لا", () => {
    expect(isWriteTool(tool())).toBe(true);
    expect(isWriteTool(tool({ risk: "admin", requiresApprovalForAgents: false }))).toBe(true);
    expect(
      isWriteTool(tool({ risk: "read", requiresApprovalForAgents: false })),
    ).toBe(false);
  });

  it("resolveSessionId: معرّف العميل يُقبل، ويُولَّد غيره", () => {
    expect(resolveSessionId("mcp-client-1")).toBe("mcp-client-1");
    expect(resolveSessionId("   ")).toMatch(/^mcp-/);
    expect(resolveSessionId(null)).toMatch(/^mcp-/);
    expect(resolveSessionId("x".repeat(200))).toMatch(/^mcp-/);
  });

  it("JSON-RPC: initialize يعيد serverInfo ويردّ بـprotocolVersion المُرسل", async () => {
    const res = (await handleMcpPayload(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      ctx(),
    )) as { result: { protocolVersion: string; serverInfo: unknown } };
    expect(res.result.protocolVersion).toBe("2025-03-26");
    expect(res.result.serverInfo).toEqual(MCP_SERVER_INFO);
  });

  it("JSON-RPC: ping فارغ · طريقة مجهولة -32601 · جسم فاسد -32600", async () => {
    const ping = (await handleMcpPayload({ jsonrpc: "2.0", id: 2, method: "ping" }, ctx())) as {
      result: Record<string, never>;
    };
    expect(ping.result).toEqual({});

    const unknown = (await handleMcpPayload(
      { jsonrpc: "2.0", id: 3, method: "resources/read" },
      ctx(),
    )) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);

    const invalid = (await handleMcpPayload({ hello: "world" }, ctx())) as {
      error: { code: number };
    };
    expect(invalid.error.code).toBe(-32600);
  });

  it("الإشعارات (بلا id) لا تُنتج استجابة", async () => {
    const res = await handleMcpPayload({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx());
    expect(res).toBeNull();
    const resUnknown = await handleMcpPayload({ jsonrpc: "2.0", method: "nope" }, ctx());
    expect(resUnknown).toBeNull();
  });
});
