import { describe, it, expect } from "vitest";
import { runPipeline } from "@/celia/adapters/aisa/adapter";
import { bridge, deriveFacts, explainLines, gateValues, loadContract, parseAdapterReport, type AdapterReport } from "@/celia/adapters/aisa/bridge";
import { EvidenceGraph } from "@/celia/nexa/index";
import path from "node:path";

const FAKE_KEY = "sk-aisa-TEST-0123456789abcdef0123456789abcdef";
const CONTRACT = loadContract(path.resolve(process.cwd(), "celia/adapters/aisa/contract.readonly.json"));
const NOW = "2026-09-26T12:00:00.000Z";

/** بوابة AIsa وهمية بالشكل الحقيقي الملاحظ في التشغيل 36287323933 (tavily 0.24 / firecrawl 0.001071، availability "unknown"). */
function mockGateway(): typeof fetch {
  let uses = 0;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = JSON.parse(String(init?.body ?? "{}")) as { params?: { name?: string; arguments?: { operation_id?: string } } };
    const params = body.params ?? {};
    const reply = (status: number, payload: unknown) =>
      new Response(
        JSON.stringify(status >= 400 ? { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "nope" } } : { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } }),
        { status, headers: { "content-type": "application/json" } },
      );
    if (headers.authorization !== `Bearer ${FAKE_KEY}`) return reply(401, null);
    const schema = { type: "object", required: ["url"], properties: { url: { type: "string" } } };
    switch (params.name) {
      case "list_categories":
        return reply(200, { categories: [{ id: "search" }], servers: [1], toolCount: 581 });
      case "search":
        return reply(200, { retrieval_mode: "semantic", candidates: [{ operation_id: "post_tavily_crawl", input_schema: schema }, { operation_id: "post_firecrawl_scrape", input_schema: schema }] });
      case "get_details":
        return reply(200, {
          total_count: 2, success_count: 2, error_count: 0,
          results: [
            { operation_id: "post_tavily_crawl", arguments_schema: schema, read_only: true, side_effects: [], availability: "unknown", price: { usd: 0.24, currency: "USD" } },
            { operation_id: "post_firecrawl_scrape", arguments_schema: schema, read_only: true, side_effects: [], availability: "unknown", price: { usd: 0.001071, currency: "USD" } },
          ],
        });
      case "use":
        if (params.arguments?.operation_id === "account") {
          uses++;
          return reply(200, { data: { key: "sk-aisa-****cdef", balance_usd: 12.5, usage: { today_calls: 10 + uses, today_usd: 0 } } });
        }
        return reply(402, null);
      default:
        return reply(404, null);
    }
  }) as typeof fetch;
}

async function adapterReport(env: Record<string, string | undefined> = { AISA_API_KEY: FAKE_KEY }): Promise<AdapterReport> {
  const orig = console.log;
  console.log = () => {};
  try {
    const { evidence } = await runPipeline(
      { query: "crawl a web page", category: "search", limit: 3, maxPriceUsd: 0.01, args: {}, autofill: true, accountSnapshot: true, out: null, json: null } as Parameters<typeof runPipeline>[0],
      env,
      mockGateway(),
    );
    return parseAdapterReport({ generated_at: NOW, facts: evidence.facts, lines: evidence.lines });
  } finally {
    console.log = orig;
  }
}

describe("Celia · AIsa evidence bridge (NEXA GEN-0 on real adapter output shape)", () => {
  it("adapter pipeline → bridge ⇒ COMPLETED; aisa=AVAILABLE; proposals cross-checked and none authorized", async () => {
    const report = await adapterReport();
    const r = bridge(report, CONTRACT, NOW);
    expect(r.facts).toEqual({
      secret_absent: false,
      mcp_auth_verified: true,
      discovery_verified: true,
      get_details_verified: true,
      paid_use: false,
      use_restricted_to_account: true,
      zero_charge_delta: true, // today_calls moved (+1) but no monetary path did
      secret_exposure: false,
    });
    expect(r.details.account_monetary_changed).toBe("0");
    expect(r.verdict.status).toBe("COMPLETED");
    expect(r.capability).toEqual({ id: "aisa", state: "AVAILABLE", evidence: ["evidence:auth"] });
    expect(r.policyCrossCheck).toEqual([
      expect.objectContaining({ operation: "post_tavily_crawl", adapter: "DENY", nexa: "DENY", authorized: false }),
      expect.objectContaining({ operation: "post_firecrawl_scrape", adapter: "DENY", nexa: "REQUIRE_APPROVAL", authorized: false }),
    ]);
    expect(r.policyCrossCheck[0]?.findings.join()).toMatch(/fixed cost 0.24 USD exceeds proposal cap 0.01/);
    expect(r.policyCrossCheck[1]?.findings.join()).toMatch(/unknown trust/);
    // graph: hash-chained, replayable, explains
    expect(r.graph.verifyChain().ok).toBe(true);
    const { graph } = EvidenceGraph.fromJSONL(r.graph.toJSONL());
    expect(graph.stats().head).toBe(r.graph.stats().head);
    const lines = explainLines(r);
    expect(lines[0]).toMatch(/^what: action:key, action:anon, action:auth, action:search, action:details/);
    expect(lines[3]).toBe("authorized by: authorization:anon(policy), authorization:auth(policy), authorization:search(policy), authorization:details(policy), authorization:account(policy)");
    expect(lines[4]).toBe("changed: nothing (read-only)");
    expect(lines[5]).toBe("verification: verification:contract=COMPLETED");
    // nothing in the bridge output leaks the key
    expect(JSON.stringify(r.summary) + r.graph.toJSONL()).not.toContain(FAKE_KEY);
    expect(r.summary[0]).toMatch(/^NEXA_OUTCOME=COMPLETED/);
    expect(r.summary.every((l) => /^[\x20-\x7E]*$/.test(l))).toBe(true); // ASCII-only annotations
  });

  it("tampered evidence claiming a paid use ⇒ FAILED (forbidden fact)", async () => {
    const report = await adapterReport();
    const tampered: AdapterReport = { ...report, lines: report.lines.map((l) => (l.startsWith("USE: ") ? l.replace("paid_use_calls=0", "paid_use_calls=1") : l)) };
    const r = bridge(tampered, CONTRACT, NOW);
    expect(r.facts.paid_use).toBe(true);
    expect(r.verdict.status).toBe("FAILED");
    expect(r.verdict.violated).toEqual(["paid_use"]);
    const gateTampered: AdapterReport = { ...report, facts: { ...report.facts, gate: { ...(report.facts.gate as Record<string, string>), AISA_PAID_USE: "EXECUTED" } } };
    expect(bridge(gateTampered, CONTRACT, NOW).verdict.status).toBe("FAILED");
  });

  it("missing ACCOUNT/USE evidence ⇒ NOT_VERIFIED (unknown is never assumed)", async () => {
    const report = await adapterReport();
    const { account_delta: _drop, ...facts } = report.facts;
    const partial: AdapterReport = { facts, lines: report.lines.filter((l) => !l.startsWith("ACCOUNT: ") && !l.startsWith("USE: ")) };
    const r = bridge(partial, CONTRACT, NOW);
    expect(r.facts.zero_charge_delta).toBe("unknown");
    expect(r.facts.paid_use).toBe("unknown");
    expect(r.verdict.status).toBe("NOT_VERIFIED");
    expect(r.verdict.unknown).toEqual(expect.arrayContaining(["use_restricted_to_account", "zero_charge_delta", "paid_use"]));
  });

  it("no secret ⇒ BLOCKED, capability stays CAN, gate parsed from the GATE line (early exit has no facts.gate)", async () => {
    const report = await adapterReport({});
    expect(report.facts.gate).toBeUndefined();
    expect(gateValues(report).AISA_SECRET_PRESENT).toBe("ABSENT");
    const r = bridge(report, CONTRACT, NOW);
    expect(r.facts.secret_absent).toBe(true);
    expect(r.verdict.status).toBe("BLOCKED");
    expect(r.capability.state).toBe("CAN");
  });

  it("a monetary delta ⇒ zero_charge_delta=false ⇒ PARTIAL; a leaked key ⇒ FAILED", async () => {
    const report = await adapterReport();
    const charged: AdapterReport = { ...report, facts: { ...report.facts, account_delta: { leaves: 13, changed: [{ path: "data.balance_usd", delta: -0.24 }] } } };
    const c = bridge(charged, CONTRACT, NOW);
    expect(c.facts.zero_charge_delta).toBe(false);
    expect(c.verdict.status).toBe("PARTIAL");
    const leaked: AdapterReport = { ...report, lines: [...report.lines, `KEY: ${FAKE_KEY}`] };
    expect(deriveFacts(leaked).facts.secret_exposure).toBe(true);
    expect(bridge(leaked, CONTRACT, NOW).verdict.status).toBe("FAILED");
    expect(deriveFacts(report).facts.secret_exposure).toBe(false); // masked "sk-aisa-****cdef" is not a leak
  });

  it("rejects malformed adapter reports", () => {
    expect(() => parseAdapterReport({ facts: {} })).toThrow(/string\[\] lines/);
    expect(() => parseAdapterReport(null)).toThrow();
  });
});
