import { describe, it, expect } from "vitest";
import { runAisaAgent } from "@/celia/adapters/aisa/agent";
import { AISA_DISCOVER_TEMPLATE, classifyAisaFailure, parseAisaResult } from "@/celia/adapters/aisa/goals";
import { FAKE_AISA_KEY, mockAisaFetch } from "../helpers/aisa-mock";

const opts = { command: "run" as const, goal: "discover aisa tools for extracting readable text from a documentation page", taskId: "task:aisa-agent-discover", db: null, json: null, graph: null, limit: 3, approval: null, by: null, reason: null };

describe("Celia GEN-2 on AIsa (mocked network) — goal → plan → gated actions → real replan → COMPLETED", () => {
  it("understands the goal, plans 4 steps, fails the anonymous search (as runtime does), replans to the authenticated search, completes by contract; no key leaks", async () => {
    const seen: Array<{ name: string; args: Record<string, unknown>; authed: boolean }> = [];
    const { report, replay } = await runAisaAgent(opts, { AISA_API_KEY: FAKE_AISA_KEY }, mockAisaFetch(seen));
    const t = report.task;
    expect(t.intent?.understoodBy).toBe("template:aisa-discover");
    expect(t.intent?.params).toEqual({ query: "extracting readable text from a documentation page", limit: 3 });
    expect(t.state).toBe("COMPLETED");
    expect(t.outcome).toMatchObject({ status: "COMPLETED", met: ["mcp_auth_verified", "discovery_verified", "get_details_verified", "account_snapshot_verified"], violated: [], unknown: [] });
    expect(t.replans).toBe(1);
    expect(seen.map((s) => `${s.name}${s.authed ? "" : "(anon)"}`)).toEqual(["list_categories", "search(anon)", "search", "get_details", "use"]);
    expect(seen[3]!.args).toEqual({ operation_ids: ["post_tavily_crawl", "post_firecrawl_scrape"] }); // bound from the verified search observation
    expect(report.gateway).toMatchObject({ submitted: 5, executed: 5, verified: 4, transport_calls: 5, ungated_calls: 0 });
    expect(replay.gate.runtime).toBe("PASS");
    expect(replay.problems).toEqual([]);
    const text = JSON.stringify(report) + report.lines.join("\n") + replay.summary.join("\n");
    expect(text).not.toContain(FAKE_AISA_KEY);
    expect(text).not.toContain("12.5"); // account values never serialized (only shapes)
    expect(t.steps.find((s) => s.step.id === "account")?.data).toEqual({ shape: "object", keys: ["data"] });
    expect(report.lines.filter((l) => /^(AGENT|PLAN|STATES|GATEWAY|OUTCOME):/.test(l) || /^STEP \w+: status=/.test(l)).length).toBeLessThanOrEqual(10);
    expect(report.lines.join("\n")).toMatch(/PLAN v2: .* rejected=1 reason="replan after step "discover": permanent failure \(observation not ok: search\(anonymous\) -> 401/);
  });

  it("without a key the blocker stops the agent before any plan or network call ⇒ BLOCKED (never FAILED, never a claim)", async () => {
    const seen: Array<{ name: string; args: Record<string, unknown>; authed: boolean }> = [];
    const { report, replay } = await runAisaAgent(opts, {}, mockAisaFetch(seen));
    expect(seen).toEqual([]);
    expect(report.task.state).toBe("BLOCKED");
    expect(report.task.blockedReason).toMatch(/BLOCKER: secret_absent/);
    expect(report.task.history.map((h) => h.to)).toEqual(["UNDERSTANDING", "BLOCKED"]);
    expect(report.task.outcome).toMatchObject({ status: "BLOCKED", blocked: ["secret_absent"] });
    expect(replay.gate.runtime).toBe("FAIL");
    expect(replay.gate.evidence_chain_valid).toBe(true);
  });

  it("template helpers: query extraction, payload parsing, failure classification", () => {
    expect(AISA_DISCOVER_TEMPLATE.matches({ text: "find tools for seo audits" })).toBe(true);
    expect(AISA_DISCOVER_TEMPLATE.matches({ text: "book a flight" })).toBe(false);
    expect(AISA_DISCOVER_TEMPLATE.params!({ text: "discover aisa capabilities about crawling", params: { limit: 2 } })).toEqual({ query: "crawling", limit: 2 });
    expect(parseAisaResult("x", { status: 200, payload: { a: 1 } })).toEqual({ a: 1 });
    expect(parseAisaResult("x", "junk")).toBeNull();
    expect(classifyAisaFailure("x", { status: 503 })).toBe("transient");
    expect(classifyAisaFailure("x", { status: 0, networkError: "ECONNRESET" })).toBe("transient");
    expect(classifyAisaFailure("x", { status: 401 })).toBe("permanent");
    expect(classifyAisaFailure("x", null)).toBe("permanent");
  });
});
