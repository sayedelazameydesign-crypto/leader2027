/**
 * Celia · adapters/aisa · **قوالب الأهداف** (GEN-2) — ما يفهمه الوكيل عن AIsa، بعقد نتيجة واستراتيجية مرشحين مرتبين.
 *
 * الاستراتيجية صادقة مع الواقع المُثبَت في GEN-1: الكتالوج يدّعي أن `search` مجاني بلا مفتاح، والتشغيل الحقيقي يردّ 401 —
 * لذا المرشح الأول للاكتشاف هو المحاولة المجهولة (كما يوثّقها الكتالوج)، والبديل هو المحاولة بالمفتاح.
 * الفشل الأول متوقَّع ⇒ RECOVERING ⇒ REPLANNING ⇒ البديل — إعادة تخطيط حقيقية على دليل حقيقي، لا سيناريو مصطنع.
 */
import type { GoalTemplate } from "../../core/agent/index.ts";
import type { PlanStep } from "../../core/task/index.ts";
import type { McpResponse } from "./adapter.ts";
import { capabilityId } from "./provider.ts";

const read = { risk: "read" as const, dataClass: "PUBLIC" as const };

export const AISA_DISCOVER_TEMPLATE: GoalTemplate = {
  id: "aisa-discover",
  describe: "Discover AIsa tool capabilities for a query, read-only, through the NEXA gateway; propose only, never execute paid use",
  matches: (goal) => /\b(discover|find|search|explore|list)\b/i.test(goal.text) && /\b(aisa|tool|tools|capabilit(y|ies)|mcp)\b/i.test(goal.text),
  params: (goal) => {
    const explicit = typeof goal.params?.query === "string" ? (goal.params.query as string) : null;
    const m = goal.text.match(/\b(?:for|about|regarding)\s+(.+)$/i);
    return { query: explicit ?? (m ? m[1]!.trim() : goal.text.trim()), limit: typeof goal.params?.limit === "number" ? goal.params.limit : 3 };
  },
  contract: {
    goal: "Discover AIsa capabilities read-only through the NEXA gateway: authenticate, search, read details, snapshot the free account view - no paid use, no ungated call, no secret exposure",
    required: ["mcp_auth_verified", "discovery_verified", "get_details_verified", "account_snapshot_verified"],
    forbidden: ["paid_use", "ungated_action", "secret_exposure"],
    blockers: ["secret_absent"],
  },
  strategy: (params): PlanStep[] => {
    const query = String(params.query ?? "");
    const limit = Number(params.limit ?? 3);
    return [
      {
        id: "authenticate",
        title: "Prove the MCP endpoint accepts the CI key",
        establishes: ["mcp_auth_verified"],
        candidates: [{ capability: capabilityId("list_categories"), operation: "list_categories", arguments: {}, ...read, note: "free meta tool; 200 with the key proves auth" }],
        expect: { ok: true, verified: true, has: ["categories"] },
      },
      {
        id: "discover",
        title: "Find candidate operations for the query",
        establishes: ["discovery_verified"],
        candidates: [
          { capability: capabilityId("search"), operation: "search", arguments: { query, limit, anonymous: true }, ...read, note: "catalogue claims search is free without a token" },
          { capability: capabilityId("search"), operation: "search", arguments: { query, limit }, ...read, note: "runtime behaviour: Bearer required" },
        ],
        expect: { ok: true, verified: true, minCount: { path: "candidates", min: 1 } },
        artifacts: [{ type: "candidate-operation-ids", from: "candidates[*].operation_id", limit: 10 }],
      },
      {
        id: "details",
        title: "Read pricing, schema and side effects of the candidates",
        establishes: ["get_details_verified"],
        candidates: [{ capability: capabilityId("get_details"), operation: "get_details", arguments: { operation_ids: { $bind: "discover.candidates[*].operation_id", limit } }, ...read }],
        expect: { ok: true, verified: true, minCount: { path: "results", min: 1 } },
        artifacts: [
          { type: "detailed-operation-ids", from: "results[*].operation_id", limit: 10 },
          { type: "declared-prices", from: "results[*].price", limit: 10 },
          { type: "declared-availability", from: "results[*].availability", limit: 10 },
        ],
      },
      {
        id: "account",
        title: "Free account snapshot (values never printed)",
        establishes: ["account_snapshot_verified"],
        candidates: [{ capability: capabilityId("use:account"), operation: "use:account", arguments: {}, ...read, note: "the only use the provider can issue" }],
        expect: { ok: true, verified: true },
      },
    ];
  },
};

export const AISA_GOAL_TEMPLATES: readonly GoalTemplate[] = [AISA_DISCOVER_TEMPLATE];

/** ما يفكّه الوكيل من ناتج المزوّد: الحمولة المفكوكة فقط. */
export const parseAisaResult = (_capability: string, result: unknown): unknown => (result && typeof result === "object" && "payload" in (result as McpResponse) ? (result as McpResponse).payload : null);

/** تصنيف الفشل: شبكة/429/5xx عابر؛ 401/403/402/4xx دائم (لا يُعاد كما هو). */
export const classifyAisaFailure = (_capability: string, result: unknown): "transient" | "permanent" => {
  const r = result as Partial<McpResponse> | null;
  if (!r || typeof r !== "object") return "permanent";
  if (r.networkError) return "transient";
  return [429, 500, 502, 503, 504].includes(Number(r.status)) ? "transient" : "permanent";
};
