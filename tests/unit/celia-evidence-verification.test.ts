import { describe, it, expect } from "vitest";
import { EvidenceGraph, evaluateOutcome, formatVerdict, parseContract, type OutcomeContract } from "@/celia/nexa/index";

const NOW = "2026-09-26T12:00:00.000Z";

describe("Outcome Contract — a task is complete only when its contract is met", () => {
  const contract: OutcomeContract = { goal: "demo", required: ["a", "b"], forbidden: ["x"], blockers: ["stop"] };

  it("COMPLETED only when all required are true and nothing forbidden/unknown", () => {
    expect(evaluateOutcome(contract, { a: true, b: true, x: false, stop: false }).status).toBe("COMPLETED");
  });
  it("forbidden true ⇒ FAILED even if everything else is fine", () => {
    expect(evaluateOutcome(contract, { a: true, b: true, x: true, stop: false }).status).toBe("FAILED");
  });
  it("blocker true ⇒ BLOCKED (not FAILED)", () => {
    const v = evaluateOutcome(contract, { a: "unknown", b: "unknown", x: false, stop: true });
    expect(v.status).toBe("BLOCKED");
    expect(v.blocked).toEqual(["stop"]);
  });
  it("some required false ⇒ PARTIAL when at least one is met, FAILED when none", () => {
    expect(evaluateOutcome(contract, { a: true, b: false, x: false, stop: false }).status).toBe("PARTIAL");
    expect(evaluateOutcome(contract, { a: false, b: false, x: false, stop: false }).status).toBe("FAILED");
  });
  it("missing or unknown facts ⇒ NOT_VERIFIED — never assumed true or false", () => {
    expect(evaluateOutcome(contract, { a: true, b: true, stop: false }).status).toBe("NOT_VERIFIED"); // x missing
    const v = evaluateOutcome(contract, { a: true, b: "unknown", x: false, stop: false });
    expect(v.status).toBe("NOT_VERIFIED");
    expect(v.unknown).toEqual(["b"]);
    expect(formatVerdict(v)).toMatch(/^OUTCOME=NOT_VERIFIED met=1 unmet=0 unknown=1/);
  });
  it("parseContract rejects empty required and required∩forbidden", () => {
    expect(() => parseContract({ goal: "g", required: [], forbidden: [] })).toThrow(/must not be empty/);
    expect(() => parseContract({ goal: "g", required: ["a"], forbidden: ["a"] })).toThrow(/both required and forbidden/);
    expect(() => parseContract({ goal: "", required: ["a"], forbidden: [] })).toThrow(/goal/);
    expect(parseContract({ goal: "g", required: ["a"], forbidden: [] })).toEqual({ goal: "g", required: ["a"], forbidden: [], blockers: [] });
  });
});

describe("Evidence Graph — append-only, hash-chained, replayable, explains what/why/proof/who/changed", () => {
  function build(): EvidenceGraph {
    const g = new EvidenceGraph();
    g.task("task:t1", NOW, { goal: "discover" });
    g.action("task:t1", "action:search", NOW, { reason: "find operations" });
    g.evidence("action:search", "evidence:search", NOW, { line: "SEARCH: 200" });
    g.authorization("action:search", "authorization:search", NOW, { basis: "policy" });
    g.action("task:t1", "action:write", NOW, { reason: "persist" });
    g.change("action:write", "change:file", NOW, { path: "notes.md" });
    g.link("action:search", "action:write", "caused", NOW);
    g.verification("task:t1", "verification:contract", NOW, { verdict: { status: "COMPLETED" } });
    return g;
  }

  it("explain() answers the five questions", () => {
    const ex = build().explain("task:t1");
    expect(ex.task?.data.goal).toBe("discover");
    expect(ex.what.map((n) => n.id)).toEqual(["action:search", "action:write"]);
    expect(ex.why).toEqual(["goal: discover", "action:search: find operations", "action:write: persist"]);
    expect(ex.proof.map((n) => n.id)).toEqual(["evidence:search"]);
    expect(ex.authorizedBy.map((n) => n.id)).toEqual(["authorization:search"]);
    expect(ex.changed.map((n) => n.id)).toEqual(["change:file"]);
    expect(ex.verification.map((n) => n.id)).toEqual(["verification:contract"]);
  });

  it("is append-only: no overwrite, no edges to unknown nodes", () => {
    const g = build();
    expect(() => g.addNode("action:search", "action", NOW)).toThrow(/append-only/);
    expect(() => g.link("action:search", "ghost", "caused", NOW)).toThrow(/unknown node/);
    expect(g.stats()).toMatchObject({ nodes: 7, edges: 7, byType: { task: 1, action: 2, evidence: 1, authorization: 1, change: 1, verification: 1 } });
  });

  it("round-trips through JSONL, verifies the chain and replays in order", () => {
    const g = build();
    const jsonl = g.toJSONL();
    expect(jsonl.trim().split("\n")).toHaveLength(14);
    const { graph, replay, chain } = EvidenceGraph.fromJSONL(jsonl);
    expect(chain.ok).toBe(true);
    expect(graph.stats().head).toBe(g.stats().head);
    expect(replay[0]).toBe("1. [task] task:t1 @ " + NOW);
    expect(replay.at(-1)).toBe("14. task:t1 -verified_by-> verification:contract");
    expect(graph.explain("task:t1").changed.map((n) => n.id)).toEqual(["change:file"]);
  });

  it("detects tampering anywhere in the log", () => {
    const jsonl = build().toJSONL();
    const tampered = jsonl.replace('"line":"SEARCH: 200"', '"line":"SEARCH: 500"');
    expect(tampered).not.toBe(jsonl);
    expect(() => EvidenceGraph.fromJSONL(tampered)).toThrow(/chain broken at seq 4/);
    const dropped = jsonl.split("\n").filter((_, i) => i !== 5).join("\n");
    expect(() => EvidenceGraph.fromJSONL(dropped)).toThrow(/chain broken/);
    expect(EvidenceGraph.fromJSONL("").graph.stats().nodes).toBe(0);
  });
});
