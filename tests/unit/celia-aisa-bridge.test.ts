import { describe, it, expect } from "vitest";
import { runPipeline } from "@/celia/adapters/aisa/pipeline";
import { bridge, deriveFacts, explainLines, gateValues, loadContract, parseAdapterReport, receiptGatedBeforeExecution, type AdapterReport } from "@/celia/adapters/aisa/bridge";
import { EvidenceGraph, type Entry } from "@/celia/nexa/index";
import path from "node:path";

const FAKE_KEY = "sk-aisa-TEST-0123456789abcdef0123456789abcdef";
const CONTRACT = loadContract(path.resolve(process.cwd(), "celia/adapters/aisa/contract.readonly.json"));
const NOW = "2026-09-26T12:00:00.000Z";

/** بوابة AIsa وهمية بالشكل الحقيقي الملاحظ في التشغيل 36288368198 (tavily 0.24 / firecrawl 0.001071، availability "unknown"). */
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
    const { evidence, graph } = await runPipeline(
      { query: "crawl a web page", category: "search", limit: 3, maxPriceUsd: 0.01, args: null, autofill: true, accountSnapshot: true, out: null, json: null },
      env,
      mockGateway(),
    );
    return parseAdapterReport({ generated_at: NOW, facts: evidence.facts, lines: evidence.lines, graph });
  } finally {
    console.log = orig;
  }
}

const COMPLETE_FACTS = {
  secret_absent: false,
  mcp_auth_verified: true,
  discovery_verified: true,
  get_details_verified: true,
  paid_use: false,
  use_restricted_to_account: true,
  zero_charge_delta: true, // today_calls moved (+1) but no monetary path did
  pre_execution_gate_verified: true,
  runtime_evidence_tampered: false,
  secret_exposure: false,
};

describe("Celia · AIsa evidence bridge (GEN-1: verifies the gateway's own runtime evidence)", () => {
  it("governed pipeline → bridge ⇒ COMPLETED; GEN1 runtime gate PASS; aisa=AVAILABLE by receipt; candidates denied before the provider", async () => {
    const report = await adapterReport();
    expect(report.graph?.length).toBeGreaterThan(50);
    const r = bridge(report, CONTRACT, NOW);
    expect(r.facts).toEqual(COMPLETE_FACTS);
    expect(r.verdict.status).toBe("COMPLETED");
    expect(r.gen1).toEqual({ runtime: "PASS", parts: { pre_execution_gate: "true", paid_use: "false", secret_exposure: "false", runtime_evidence_tampered: "false", tests_pass: "ci" } });
    expect(r.details.gateway).toBe("submitted=8 executed=6 transport_calls=6 ungated_calls=0 ordered_receipts=yes");
    expect(r.details.gateway_denied).toBe("POLICY:1,APPROVAL:1");
    expect(r.capability).toEqual({ id: "aisa", state: "AVAILABLE", evidence: ["action:act-3"] }); // the list_categories receipt, not a claim
    expect(r.receipts.filter((x) => x.operation.startsWith("use:") && x.operation !== "use:account")).toEqual([
      expect.objectContaining({ operation: "use:post_tavily_crawl", outcome: "DENIED", deniedAt: "POLICY", policy: "DENY" }),
      expect.objectContaining({ operation: "use:post_firecrawl_scrape", outcome: "DENIED", deniedAt: "APPROVAL", policy: "REQUIRE_APPROVAL" }),
    ]);
    expect(r.receipts.filter((x) => x.outcome === "EXECUTED").every(receiptGatedBeforeExecution)).toBe(true);
    // the bridge continued the runtime chain (same head lineage), and the result replays
    expect(r.runtimeChain).toMatchObject({ present: true, ok: true, entries: report.graph!.length });
    expect(r.graph.verifyChain().ok).toBe(true);
    const { graph } = EvidenceGraph.fromJSONL(r.graph.toJSONL());
    expect(graph.stats().head).toBe(r.graph.stats().head);
    expect(graph.getNode("action:act-1")?.data).toMatchObject({ operation: "use:account", outcome: "EXECUTED" });
    const lines = explainLines(r);
    expect(lines[0]).toMatch(/^what: action:act-1\[use:account:EXECUTED\], action:act-2\[search:EXECUTED\], action:act-3\[list_categories:EXECUTED\]/);
    expect(lines[3]).toMatch(/action:act-3:authorization\(policy\)/);
    expect(lines[4]).toBe("changed: nothing (read-only)");
    expect(lines[5]).toMatch(/^verification: verification:contract=COMPLETED/);
    expect(JSON.stringify(r.summary) + r.graph.toJSONL()).not.toContain(FAKE_KEY);
    expect(r.summary[0]).toMatch(/^NEXA_OUTCOME=COMPLETED/);
    expect(r.summary[1]).toBe("NEXA_GEN1_GATE runtime=PASS pre_execution_gate=true paid_use=false secret_exposure=false runtime_evidence_tampered=false tests_pass=ci");
    expect(r.summary.every((l) => /^[\x20-\x7E]*$/.test(l))).toBe(true); // ASCII-only annotations
  });

  it("tampering with the runtime evidence graph ⇒ runtime_evidence_tampered=true ⇒ FAILED", async () => {
    const report = await adapterReport();
    const graph = report.graph!.map((e) => ({ ...e })) as Entry[];
    const victim = graph.find((e) => e.kind === "node" && e.id === "action:act-6")!; // the denied paid candidate
    (victim as unknown as { data: Record<string, unknown> }).data = { ...(victim as unknown as { data: Record<string, unknown> }).data, outcome: "EXECUTED" };
    const r = bridge({ ...report, graph }, CONTRACT, NOW);
    expect(r.facts.runtime_evidence_tampered).toBe(true);
    expect(r.verdict.status).toBe("FAILED");
    expect(r.verdict.violated).toEqual(["runtime_evidence_tampered"]);
    expect(r.gen1.runtime).toBe("FAIL");
    expect(r.runtimeChain).toMatchObject({ present: true, ok: false });
  });

  it("gateway facts that claim a paid execution or ungated calls ⇒ FAILED / PARTIAL", async () => {
    const report = await adapterReport();
    const gw = report.facts.gateway as Record<string, unknown> & { receipts: Array<Record<string, unknown>> };
    const paidReceipt = { ...gw.receipts.find((x) => x.operation === "use:post_tavily_crawl")!, outcome: "EXECUTED" };
    const paid = bridge({ ...report, facts: { ...report.facts, gateway: { ...gw, receipts: gw.receipts.map((x) => (x.operation === "use:post_tavily_crawl" ? paidReceipt : x)) } } }, CONTRACT, NOW);
    expect(paid.facts.paid_use).toBe(true);
    expect(paid.verdict.status).toBe("FAILED");
    const ungated = bridge({ ...report, facts: { ...report.facts, gateway: { ...gw, transport_calls: 7, ungated_calls: 1 } } }, CONTRACT, NOW);
    expect(ungated.facts.pre_execution_gate_verified).toBe(false);
    expect(ungated.verdict.status).toBe("PARTIAL");
    expect(ungated.gen1.runtime).toBe("FAIL");
  });

  it("GEN-0 report shape (no gateway facts, no graph) ⇒ gate facts unknown ⇒ NOT_VERIFIED, never assumed", async () => {
    const report = await adapterReport();
    const { gateway: _g, ...facts } = report.facts;
    const legacy: AdapterReport = { facts, lines: report.lines.filter((l) => !l.startsWith("GATEWAY")) };
    const r = bridge(legacy, CONTRACT, NOW);
    expect(r.facts.pre_execution_gate_verified).toBe("unknown");
    expect(r.facts.runtime_evidence_tampered).toBe("unknown");
    expect(r.verdict.status).toBe("NOT_VERIFIED");
    expect(r.gen1.runtime).toBe("NOT_VERIFIED");
    expect(r.summary.at(-1)).toMatch(/post-hoc verification only \(GEN-0 report shape/);
  });

  it("missing ACCOUNT/USE evidence ⇒ NOT_VERIFIED; a monetary delta ⇒ PARTIAL; a leaked key ⇒ FAILED", async () => {
    const report = await adapterReport();
    const { account_delta: _drop, ...facts } = report.facts;
    const partial = bridge({ ...report, facts, lines: report.lines.filter((l) => !l.startsWith("ACCOUNT: ") && !l.startsWith("USE: ")) }, CONTRACT, NOW);
    expect(partial.facts.zero_charge_delta).toBe("unknown");
    expect(partial.facts.paid_use).toBe("unknown");
    expect(partial.verdict.status).toBe("NOT_VERIFIED");
    const charged = bridge({ ...report, facts: { ...report.facts, account_delta: { leaves: 13, changed: [{ path: "data.balance_usd", delta: -0.24 }] } } }, CONTRACT, NOW);
    expect(charged.facts.zero_charge_delta).toBe(false);
    expect(charged.verdict.status).toBe("PARTIAL");
    const leaked: AdapterReport = { ...report, lines: [...report.lines, `KEY: ${FAKE_KEY}`] };
    expect(deriveFacts(leaked, { present: true, ok: true }).facts.secret_exposure).toBe(true);
    expect(bridge(leaked, CONTRACT, NOW).verdict.status).toBe("FAILED");
    expect(deriveFacts(report, { present: true, ok: true }).facts.secret_exposure).toBe(false); // masked "sk-aisa-****cdef" is not a leak
  });

  it("no secret ⇒ BLOCKED, capability stays CAN, gate parsed from the GATE line", async () => {
    const report = await adapterReport({});
    expect(gateValues(report).AISA_SECRET_PRESENT).toBe("ABSENT");
    const r = bridge(report, CONTRACT, NOW);
    expect(r.facts.secret_absent).toBe(true);
    expect(r.facts.pre_execution_gate_verified).toBe(true); // the single anonymous probe was gated too
    expect(r.verdict.status).toBe("BLOCKED");
    expect(r.capability.state).toBe("CAN");
  });

  it("rejects malformed adapter reports; receiptGatedBeforeExecution rejects out-of-order or ungated histories", () => {
    expect(() => parseAdapterReport({ facts: {} })).toThrow(/string\[\] lines/);
    expect(() => parseAdapterReport(null)).toThrow();
    const base = { actionId: "a", operation: "search", outcome: "EXECUTED", deniedAt: null, stage: "MEMORY", ladder: "VERIFIED", registryState: null, policy: "ADMIT", basis: "policy", reason: null };
    expect(receiptGatedBeforeExecution({ ...base, stages: ["INTENT", "PROPOSAL", "CAPABILITY", "POLICY", "AUTHORIZATION", "APPROVAL", "EXECUTION", "OBSERVATION"] })).toBe(true);
    expect(receiptGatedBeforeExecution({ ...base, stages: ["INTENT", "PROPOSAL", "CAPABILITY", "EXECUTION", "POLICY", "AUTHORIZATION", "APPROVAL", "OBSERVATION"] })).toBe(false);
    expect(receiptGatedBeforeExecution({ ...base, stages: ["INTENT", "PROPOSAL", "EXECUTION", "OBSERVATION"] })).toBe(false);
    expect(receiptGatedBeforeExecution({ ...base, stage: "EXECUTION", stages: ["INTENT", "PROPOSAL", "CAPABILITY", "POLICY", "AUTHORIZATION", "APPROVAL", "EXECUTION"] })).toBe(false);
  });
});
