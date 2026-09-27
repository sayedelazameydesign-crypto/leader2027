import { describe, it, expect } from "vitest";
import {
  AisaPolicyError,
  READ_ONLY_TOOLS,
  accountSnapshot,
  autofillArguments,
  callReadOnlyTool,
  createTransport,
  decide,
  normalizePrice,
  numericDelta,
  runPipeline,
  sanitize,
  validateArgs,
  type OperationDetails,
  type Proposal,
} from "@/integrations/aisa/adapter";

const FAKE_KEY = "sk-aisa-TEST-0123456789abcdef0123456789abcdef";

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** fetch وهمي: يسجّل الطلب ويردّ بحسب اسم الأداة ووجود Bearer. */
function mockFetch(seen: Seen[], opts: { sse?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    seen.push({ url: String(input), headers, body });
    const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const authed = headers.authorization === `Bearer ${FAKE_KEY}`;
    const reply = (status: number, payload: unknown) => {
      const rpc = status >= 400
        ? { jsonrpc: "2.0", id: 1, error: { code: status === 401 ? -32001 : -32000, message: "nope" } }
        : { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } };
      if (opts.sse) {
        return new Response(`event: message\ndata: ${JSON.stringify(rpc)}\n\n`, { status, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify(rpc), { status, headers: { "content-type": "application/json" } });
    };
    if (!authed) return reply(401, null);
    switch (params.name) {
      case "list_categories":
        return reply(200, { categories: [{ id: "search" }, { id: "finance" }], servers: [1, 2, 3], toolCount: 581 });
      case "search":
        return reply(200, {
          retrieval_mode: "semantic",
          candidates: [
            { operation_id: "tavily.extract", input_schema: { type: "object", required: ["urls"], properties: { urls: { type: "array" } } } },
            { operation_id: "web.search", input_schema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } },
          ],
          search_id: "s-1",
        });
      case "get_details":
        return reply(200, {
          operations: [
            {
              operation_id: "tavily.extract",
              arguments_schema: { type: "object", required: ["urls"], properties: { urls: { type: "array", items: { type: "string" } } }, additionalProperties: false },
              read_only: true,
              side_effects: [],
              availability: "available",
              price: { usd: 0.002, currency: "USD" },
              known_pitfalls: ["rate limited"],
            },
            { operation_id: "web.search", arguments_schema: { type: "object", required: ["query"] }, read_only: true, availability: "available", price: "dynamic" },
          ],
        });
      case "use":
        if (params.arguments?.operation_id === "account") {
          const n = seen.filter((s) => (s.body.params as { name?: string })?.name === "use").length;
          return reply(200, { call_id: "c", operation_id: "account", successful: true, data: { key: "sk-aisa-****cdef", balance_usd: 12.5, usage: { today_calls: 10 + n, today_usd: 0.0 } } });
        }
        return reply(402, null);
      default:
        return reply(404, null);
    }
  }) as typeof fetch;
}

describe("AIsa read-only adapter — allowlist", () => {
  it("refuses use/batch_use before any network call", async () => {
    const seen: Seen[] = [];
    const t = createTransport({ apiKey: FAKE_KEY, fetchImpl: mockFetch(seen) });
    for (const bad of ["use", "batch_use", "tools/list", ""]) {
      expect(() => callReadOnlyTool(t, bad as never, {})).toThrow(AisaPolicyError);
    }
    expect(seen).toHaveLength(0);
    expect([...READ_ONLY_TOOLS]).toEqual(["list_categories", "search", "get_details"]);
  });

  it("accountSnapshot is the only `use` and its operation_id is hard-coded", async () => {
    const seen: Seen[] = [];
    const t = createTransport({ apiKey: FAKE_KEY, fetchImpl: mockFetch(seen) });
    const r = await accountSnapshot(t);
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(seen[0].body.params).toMatchObject({ name: "use", arguments: { operation_id: "account" } });
  });

  it("parses SSE responses too", async () => {
    const seen: Seen[] = [];
    const t = createTransport({ apiKey: FAKE_KEY, fetchImpl: mockFetch(seen, { sse: true }) });
    const r = await callReadOnlyTool(t, "list_categories", {});
    expect(r.status).toBe(200);
    expect((r.payload as { toolCount: number }).toolCount).toBe(581);
  });

  it("anonymous calls carry no Authorization header and surface 401 as isError", async () => {
    const seen: Seen[] = [];
    const t = createTransport({ apiKey: null, fetchImpl: mockFetch(seen) });
    const r = await callReadOnlyTool(t, "search", { query: "x", limit: 1 });
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(r.status).toBe(401);
    expect(r.isError).toBe(true);
  });
});

describe("AIsa read-only adapter — price normalisation", () => {
  it("classifies free / fixed / dynamic / unknown", () => {
    expect(normalizePrice(0).kind).toBe("free");
    expect(normalizePrice(0.01)).toMatchObject({ kind: "fixed", usd: 0.01 });
    expect(normalizePrice("free").kind).toBe("free");
    expect(normalizePrice("$0.002 per call")).toMatchObject({ kind: "fixed", usd: 0.002 });
    expect(normalizePrice("dynamic — depends on rows").kind).toBe("dynamic");
    expect(normalizePrice({ usd: 0.5 })).toMatchObject({ kind: "fixed", usd: 0.5 });
    expect(normalizePrice({ max_usd: 2, usd: 0.1 })).toMatchObject({ kind: "fixed", usd: 2, source: "object.max_usd" });
    expect(normalizePrice({ kind: "dynamic" }).kind).toBe("dynamic");
    expect(normalizePrice({ amount: 1, currency: "EUR" }).kind).toBe("unknown");
    expect(normalizePrice(undefined).kind).toBe("unknown");
    expect(normalizePrice({ note: "see docs" }).kind).toBe("unknown");
  });
});

describe("AIsa read-only adapter — schema subset validator", () => {
  const schema = {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string", minLength: 3 }, limit: { type: "integer", minimum: 1, maximum: 10 }, mode: { enum: ["fast", "deep"] } },
    additionalProperties: false,
  };
  it("passes valid input and reports subset=true", () => {
    expect(validateArgs(schema, { query: "abc", limit: 3, mode: "fast" })).toEqual({ ok: true, errors: [], subset: true });
  });
  it("fails on missing required / wrong type / bounds / enum / additional props", () => {
    const r = validateArgs(schema, { limit: 11, mode: "slow", extra: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/query: required/);
    expect(r.errors.join("\n")).toMatch(/limit: > maximum/);
    expect(r.errors.join("\n")).toMatch(/mode: not in enum/);
    expect(r.errors.join("\n")).toMatch(/extra: additional property/);
    expect(validateArgs(schema, { query: 5 }).errors.join()).toMatch(/expected string, got integer/);
  });
  it("no schema => cannot validate", () => {
    expect(validateArgs(null, {}).ok).toBe(false);
  });
});

describe("AIsa read-only adapter — policy decision", () => {
  const base: OperationDetails = {
    operation_id: "op",
    arguments_schema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
    read_only: true,
    side_effects: [],
    availability: "available",
    price: 0,
  };
  const proposal: Proposal = { operation_id: "op", arguments: { query: "x" }, max_price_usd: 0 };

  it("admits a free, read-only, available, schema-valid proposal (never an execution permit)", () => {
    const d = decide(base, proposal);
    expect(d.decision).toBe("ADMIT_TO_AUTHORIZATION");
    expect(d.reasons).toEqual([]);
  });
  it("fixed price within cap admits; above cap denies", () => {
    const paid = { ...base, price: { usd: 0.005 } };
    expect(decide(paid, { ...proposal, max_price_usd: 0.01 }, { maxPriceUsd: 0.01, requireReadOnly: true, requireAvailable: true }).decision).toBe("ADMIT_TO_AUTHORIZATION");
    const over = decide(paid, { ...proposal, max_price_usd: 0.001 }, { maxPriceUsd: 0.001, requireReadOnly: true, requireAvailable: true });
    expect(over.decision).toBe("DENY");
    expect(over.reasons.join()).toMatch(/not within cap/);
  });
  it("dynamic or unknown price is denied even with a generous cap", () => {
    for (const price of ["dynamic", undefined, { note: "?" }]) {
      const d = decide({ ...base, price }, { ...proposal, max_price_usd: 100 }, { maxPriceUsd: 100, requireReadOnly: true, requireAvailable: true });
      expect(d.decision).toBe("DENY");
    }
  });
  it("proposal cap above policy cap is denied", () => {
    const d = decide(base, { ...proposal, max_price_usd: 5 }, { maxPriceUsd: 1, requireReadOnly: true, requireAvailable: true });
    expect(d.reasons.join()).toMatch(/exceeds policy cap/);
  });
  it("write operations, side effects, unavailability, bad schema, id mismatch => DENY", () => {
    expect(decide({ ...base, read_only: false }, proposal).decision).toBe("DENY");
    expect(decide({ ...base, read_only: undefined }, proposal).reasons.join()).toMatch(/undeclared/);
    expect(decide({ ...base, side_effects: ["sends email"] }, proposal).reasons.join()).toMatch(/side_effects: present/);
    expect(decide({ ...base, availability: { status: "degraded" } }, proposal).reasons.join()).toMatch(/availability: not_ok/);
    expect(decide({ ...base, availability: undefined }, proposal).reasons.join()).toMatch(/availability: unknown/);
    expect(decide(base, { ...proposal, arguments: {} }).reasons.join()).toMatch(/schema: .*query: required/);
    expect(decide({ ...base, arguments_schema: null }, proposal).checks.schema).toBe("missing");
    expect(decide({ ...base, operation_id: "other" }, proposal).reasons.join()).toMatch(/mismatch/);
  });
});

describe("AIsa read-only adapter — evidence hygiene", () => {
  it("sanitize redacts secrets and non-ASCII", () => {
    expect(sanitize(`key=${FAKE_KEY} عربي`, [FAKE_KEY])).toBe("key=<redacted> ????");
  });
  it("numericDelta reports path names and deltas only", () => {
    const d = numericDelta({ usage: { today: 1, usd: "0.5" }, keep: 3 }, { usage: { today: 2, usd: "0.5" }, keep: 3 });
    expect(d.leaves).toBe(3);
    expect(d.changed).toEqual([{ path: "usage.today", delta: 1 }]);
  });
  it("autofill fills only required query/url style fields", () => {
    const { args, filled } = autofillArguments({ type: "object", required: ["urls", "depth"], properties: { urls: { type: "array" }, depth: { type: "integer" } } }, "q");
    expect(filled).toEqual(["urls"]);
    expect(args).toEqual({ urls: ["https://aisa.one/docs/agent-skills"] });
  });
});

describe("AIsa read-only adapter — full pipeline (mocked network)", () => {
  const opts = { query: "find the docs page", category: null, limit: 2, maxPriceUsd: 0.01, args: null, autofill: true, accountSnapshot: true, out: null, json: null };

  it("produces the evidence chain, never leaks the key, never issues a paid use", async () => {
    const seen: Seen[] = [];
    const lines: string[] = [];
    const orig = console.log;
    console.log = (l: string) => { lines.push(String(l)); };
    let result: Awaited<ReturnType<typeof runPipeline>>;
    try {
      result = await runPipeline(opts, { AISA_API_KEY: FAKE_KEY }, mockFetch(seen));
    } finally {
      console.log = orig;
    }
    expect(result.ok).toBe(true);
    const text = result.evidence.lines.join("\n") + JSON.stringify(result.evidence.facts) + lines.join("\n");
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("****cdef"); // no account values either
    expect(text).toMatch(/AISA_SEARCH_ANONYMOUS=CONTRADICTED_BY_RUNTIME/);
    expect(text).toMatch(/AISA_MCP_AUTH=VERIFIED/);
    expect(text).toMatch(/AISA_DISCOVERY=VERIFIED/);
    expect(text).toMatch(/AISA_GET_DETAILS=VERIFIED/);
    expect(text).toMatch(/AISA_PAID_USE=NOT_EXECUTED/);
    expect(text).toMatch(/decision=ADMIT_TO_AUTHORIZATION/); // tavily.extract: fixed 0.002 <= 0.01, read-only, available, urls autofilled
    expect(text).toMatch(/autofilled=\[urls\]/);
    // the server counts our own free `account` calls: today_calls moves by +1, today_usd does not — printed as path+delta only
    expect(text).toMatch(/billing_related_changed=1 \[data\.usage\.today_calls:\+1\]/);
    expect(text).not.toMatch(/today_usd/);
    const useCalls = seen.filter((s) => (s.body.params as { name: string }).name === "use");
    expect(useCalls.every((s) => (s.body.params as { arguments: { operation_id: string } }).arguments.operation_id === "account")).toBe(true);
    expect(useCalls).toHaveLength(2);
  });

  it("without a key: anonymous probe only, ok=false, gate says ABSENT", async () => {
    const seen: Seen[] = [];
    const orig = console.log;
    console.log = () => {};
    let result: Awaited<ReturnType<typeof runPipeline>>;
    try {
      result = await runPipeline({ ...opts, accountSnapshot: false }, {}, mockFetch(seen));
    } finally {
      console.log = orig;
    }
    expect(result.ok).toBe(false);
    expect(result.evidence.lines.join("\n")).toMatch(/AISA_SECRET_PRESENT=ABSENT/);
    expect(seen).toHaveLength(1); // only the anonymous search probe
  });
});
