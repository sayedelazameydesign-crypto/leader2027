import { describe, it, expect } from "vitest";
import {
  CapabilityRegistry,
  CostGuard,
  DeniedExecutor,
  EvidenceGraph,
  ExecutionGateway,
  ProviderExecution,
  ResourceGuard,
  levelOf,
  proposalHash,
  receiptSummary,
  type Capability,
  type Grant,
  type GatewayRequest,
  type ProviderResult,
} from "@/celia/nexa/index";

let tick = 0;
const now = () => `2026-09-26T12:00:${String(tick++ % 60).padStart(2, "0")}.000Z`;

const readCap: Capability = { id: "p:read", kind: "tool", provider: "p", risk: "read", costModel: "free", fixedCostUsd: 0, dataClearance: "INTERNAL", readOnly: true, version: "1", trust: "declared" };
const paidCap: Capability = { ...readCap, id: "p:paid", costModel: "fixed", fixedCostUsd: 0.005 };
const writeCap: Capability = { ...readCap, id: "p:write", risk: "write", readOnly: false };
const alienCap: Capability = { ...readCap, id: "alien:read", provider: "alien" };
const unboundCap: Capability = { ...readCap, id: "q:read", provider: "q" };

const request = (over: Partial<GatewayRequest> = {}): GatewayRequest => ({
  intentId: "i1",
  agentId: "agent",
  capability: "p:read",
  operation: "read",
  arguments: { q: "x" },
  risk: "read",
  dataClass: "PUBLIC",
  maxCostUsd: 0,
  proposedBy: "test",
  ...over,
});

function harness(opts: { grants?: Grant[]; provider?: (op: string) => Promise<ProviderResult>; caps?: Capability[]; limits?: { perTaskUsd: number; perAgentUsd: number; totalUsd: number }; resourceGuard?: ResourceGuard } = {}) {
  const registry = new CapabilityRegistry();
  for (const c of opts.caps ?? [readCap, paidCap, writeCap, alienCap, unboundCap]) registry.register(c);
  const calls: string[] = [];
  const boundary = new ProviderExecution("p-exec", async (op) => {
    calls.push(op);
    return opts.provider ? opts.provider(op) : { ok: true, status: 200, summary: `${op} -> 200`, costUsd: 0, sideEffects: [], result: { op } };
  });
  const grants = opts.grants ?? [];
  const consumed: Grant[] = [];
  const costGuard = new CostGuard(opts.limits ?? { perTaskUsd: 0.01, perAgentUsd: 0.01, totalUsd: 0.01 });
  const graph = new EvidenceGraph();
  const gateway = new ExecutionGateway({
    taskId: "task:t",
    goal: "gateway test",
    registry,
    providers: ["p", "q"],
    boundaries: { p: boundary },
    costGuard,
    grants: () => grants.map((g) => consumed.find((c) => c.id === g.id) ?? g),
    onGrantConsumed: (g) => consumed.push(g),
    graph,
    resourceGuard: opts.resourceGuard,
    resources: opts.resourceGuard ? { p: { requests: "p.requests", spendUsd: "p.spend" } } : undefined,
    now,
  });
  return { gateway, registry, boundary, calls, costGuard, graph, consumed };
}

describe("ExecutionGateway — NEXA decides BEFORE execution", () => {
  it("free read: full protocol INTENT→MEMORY, ladder ends VERIFIED, exactly one provider call after POLICY/AUTHORIZATION/APPROVAL", async () => {
    const h = harness();
    const r = await h.gateway.submit(request());
    expect(r.outcome).toBe("EXECUTED");
    expect(r.verified).toBe(true);
    expect(r.stage).toBe("MEMORY");
    expect(r.ladder).toBe("VERIFIED");
    expect(r.registryState).toBe("CAN");
    expect(r.history.map((h) => h.stage)).toEqual(["INTENT", "PROPOSAL", "CAPABILITY", "CAPABILITY", "POLICY", "AUTHORIZATION", "APPROVAL", "APPROVAL", "APPROVAL", "EXECUTION", "OBSERVATION", "OBSERVATION", "VERIFICATION", "VERIFICATION", "EVIDENCE", "MEMORY"]);
    const stages = r.history.map((h) => h.stage);
    expect(stages.indexOf("APPROVAL")).toBeLessThan(stages.indexOf("EXECUTION"));
    expect(h.calls).toEqual(["read"]);
    expect(r.observation?.result).toEqual({ op: "read" });
    expect(r.authorization).toMatchObject({ authorized: true, basis: "policy" });
    expect(r.proposalHash).toBe(proposalHash({ capability: "p:read", operation: "read", arguments: { q: "x" }, maxCostUsd: 0 }));
    // evidence: action + policy + authorization + observation + verification nodes, chained
    expect(h.graph.getNode("action:act-1")?.data).toMatchObject({ outcome: "EXECUTED", ladder: "VERIFIED" });
    expect(h.graph.out("action:act-1", "authorized_by").map((n) => n.id)).toEqual(["action:act-1:authorization"]);
    expect(h.graph.verifyChain().ok).toBe(true);
    expect(r.evidenceHead).toBe(h.graph.stats().head);
    expect(receiptSummary(r)).toMatchObject({ actionId: "action:act-1", outcome: "EXECUTED", policy: "ADMIT", basis: "policy", cost: 0 });
  });

  it("unknown capability / unknown provider / unbound provider ⇒ DENIED at CAPABILITY with zero provider calls — and the denial is evidence", async () => {
    const h = harness();
    const a = await h.gateway.submit(request({ capability: "nope" }));
    expect(a).toMatchObject({ outcome: "DENIED", deniedAt: "CAPABILITY", ladder: "CAN", stage: "PROPOSAL" });
    expect(a.reason).toMatch(/unknown capability/);
    const b = await h.gateway.submit(request({ capability: "alien:read" }));
    expect(b.reason).toMatch(/unknown provider "alien"/);
    const c = await h.gateway.submit(request({ capability: "q:read" }));
    expect(c.reason).toMatch(/no execution boundary bound for provider "q"/);
    expect(h.calls).toEqual([]);
    expect(h.graph.getNode("action:act-2")?.data).toMatchObject({ outcome: "DENIED", deniedAt: "CAPABILITY" });
    expect(h.gateway.stats()).toMatchObject({ submitted: 3, executed: 0, denied: { CAPABILITY: 3 } });
  });

  it("policy DENY (data class, dynamic cost, understated risk) ⇒ DENIED at POLICY before any call", async () => {
    const h = harness();
    expect((await h.gateway.submit(request({ dataClass: "SECRET" }))).deniedAt).toBe("POLICY");
    expect((await h.gateway.submit(request({ capability: "p:write", operation: "write", risk: "read" }))).reason).toMatch(/understated/);
    expect((await h.gateway.submit(request({ capability: "p:paid", operation: "paid", maxCostUsd: 0.001 }))).reason).toMatch(/exceeds proposal cap/);
    expect(h.calls).toEqual([]);
  });

  it("no approval → no risky execution: write without a grant is DENIED at APPROVAL; with a matching grant it executes once and burns the grant", async () => {
    const grant: Grant = { id: "g1", grantedBy: "owner", role: "owner", scope: { capability: "p:write", operation: "write", proposalHash: null }, maxCostUsd: 0, expiresAt: "2027-01-01T00:00:00.000Z", singleUse: true, usedAt: null };
    const h = harness({ grants: [grant] });
    const granted = await h.gateway.submit(request({ capability: "p:write", operation: "write", risk: "write", arguments: { path: "a" }, proposedBy: "agent" }));
    // grant is scoped to capability+operation (hash-free) ⇒ this write executes, once
    expect(granted.outcome).toBe("EXECUTED");
    expect(granted.authorization?.basis).toBe("grant");
    expect(h.consumed.map((g) => g.id)).toEqual(["g1"]);
    const again = await h.gateway.submit(request({ capability: "p:write", operation: "write", risk: "write", arguments: { path: "b" } }));
    expect(again).toMatchObject({ outcome: "DENIED", deniedAt: "APPROVAL" });
    expect(again.reason).toMatch(/approval required/);
    expect(h.calls).toEqual(["write"]);
    const never = harness();
    expect((await never.gateway.submit(request({ capability: "p:write", operation: "write", risk: "write" }))).deniedAt).toBe("APPROVAL");
    expect(never.calls).toEqual([]);
  });

  it("paid actions need a grant AND a reservation; observed cost settles the reservation; budget exhaustion ⇒ DENIED at COST", async () => {
    const grant = (id: string): Grant => ({ id, grantedBy: "owner", role: "owner", scope: { capability: "p:paid", operation: null, proposalHash: null }, maxCostUsd: 0.01, expiresAt: "2027-01-01T00:00:00.000Z", singleUse: true, usedAt: null });
    const h = harness({ grants: [grant("g1"), grant("g2")], provider: async (op) => ({ ok: true, status: 200, summary: `${op} ok`, costUsd: 0.004, sideEffects: [] }), limits: { perTaskUsd: 0.006, perAgentUsd: 0.006, totalUsd: 0.006 } });
    const first = await h.gateway.submit(request({ capability: "p:paid", operation: "paid", maxCostUsd: 0.005 }));
    expect(first).toMatchObject({ outcome: "EXECUTED", verified: true, reservationId: "res-1" });
    expect(h.costGuard.remaining("task:t", "agent").task).toBeCloseTo(0.002, 6); // settled at 0.004, not the 0.005 reserved
    const second = await h.gateway.submit(request({ capability: "p:paid", operation: "paid", maxCostUsd: 0.005 }));
    expect(second).toMatchObject({ outcome: "DENIED", deniedAt: "POLICY" }); // remaining budget 0.002 < fixed 0.005 ⇒ policy cost rule
    expect(h.calls).toEqual(["paid"]);
  });

  it("boundary failure ⇒ DENIED at EXECUTION, reservation released; observation contradicting the proposal is not verified", async () => {
    const grant: Grant = { id: "g", grantedBy: "owner", role: "owner", scope: { capability: "p:paid", operation: null, proposalHash: null }, maxCostUsd: 1, expiresAt: "2027-01-01T00:00:00.000Z", singleUse: false, usedAt: null };
    const h = harness({ grants: [grant], provider: async () => { throw new Error("provider exploded"); } });
    const r = await h.gateway.submit(request({ capability: "p:paid", operation: "paid", maxCostUsd: 0.005 }));
    expect(r).toMatchObject({ outcome: "DENIED", deniedAt: "EXECUTION", stage: "EXECUTION", ladder: "EXECUTABLE" });
    expect(h.costGuard.entries().map((e) => e.event)).toEqual(["reserve", "release"]);
    const h2 = harness({ provider: async (op) => ({ ok: false, status: 500, summary: `${op} -> 500`, costUsd: 0, sideEffects: [] }) });
    const r2 = await h2.gateway.submit(request());
    expect(r2).toMatchObject({ outcome: "EXECUTED", verified: false, ladder: "EXECUTED", stage: "MEMORY" });
    const h3 = harness({ provider: async (op) => ({ ok: true, status: 200, summary: op, costUsd: 0, sideEffects: ["wrote /tmp/x"] }) });
    const r3 = await h3.gateway.submit(request());
    expect(r3).toMatchObject({ outcome: "DENIED", deniedAt: "EXECUTION" }); // read produced side effects ⇒ boundary refuses the observation
    expect(r3.reason).toMatch(/SIDE_EFFECTS_ON_READ/);
  });

  it("a DeniedExecutor-bound provider never executes; a boundary for an unlisted provider is a configuration error", async () => {
    const registry = new CapabilityRegistry();
    registry.register(readCap);
    const gw = new ExecutionGateway({ taskId: "t", goal: "g", registry, providers: ["p"], boundaries: { p: new DeniedExecutor() }, costGuard: new CostGuard({ perTaskUsd: 0, perAgentUsd: 0, totalUsd: 0 }), now });
    const r = await gw.submit(request());
    expect(r).toMatchObject({ outcome: "DENIED", deniedAt: "EXECUTION" });
    expect(r.reason).toMatch(/EXECUTION_NOT_BOUND/);
    expect(() => new ExecutionGateway({ taskId: "t", goal: "g", registry, providers: ["p"], boundaries: { zzz: new DeniedExecutor() }, costGuard: new CostGuard({ perTaskUsd: 0, perAgentUsd: 0, totalUsd: 0 }) })).toThrow(/unlisted provider/);
  });

  it("resource guard: quotas fail closed — SAFE_MODE keeps free reads, DENY stops everything; usage is recorded per execution", async () => {
    const guard = new ResourceGuard({ "p.requests": { limit: 10, used: 9, unit: "count" }, "p.spend": { limit: 0.01, unit: "usd" } });
    const h = harness({ resourceGuard: guard });
    const ok = await h.gateway.submit(request()); // 9+1 = 100% ⇒ DENY level for this request
    expect(ok).toMatchObject({ outcome: "DENIED", deniedAt: "POLICY" });
    expect(ok.reason).toMatch(/quota exhausted/);
    const guard2 = new ResourceGuard({ "p.requests": { limit: 100, used: 94, unit: "count" }, "p.spend": { limit: 0.01, unit: "usd" } });
    const h2 = harness({ resourceGuard: guard2 });
    const read = await h2.gateway.submit(request()); // 95% ⇒ SAFE_MODE: free read allowed
    expect(read.outcome).toBe("EXECUTED");
    expect(guard2.status("p.requests").used).toBe(95);
    const write = await h2.gateway.submit(request({ capability: "p:write", operation: "write", risk: "write" }));
    expect(write.reason).toMatch(/safe mode: only free read actions/);
    expect(h2.calls).toEqual(["read"]);
    expect(guard2.mode()).toBe("SAFE_MODE");
    expect(guard2.summary()).toMatch(/p\.requests=95\/100 \(95% SAFE_MODE\)/);
  });
});

describe("ResourceGuard levels", () => {
  it("80/90/95/100 thresholds and RESTRICT semantics", () => {
    expect([0, 0.79, 0.8, 0.9, 0.95, 1, 2].map(levelOf)).toEqual(["NORMAL", "NORMAL", "WARN", "RESTRICT", "SAFE_MODE", "DENY", "DENY"]);
    const g = new ResourceGuard({ r: { limit: 100, used: 89, unit: "count" } });
    expect(g.admit("r", 1, { risk: "read", paid: false })).toMatchObject({ ok: true, level: "RESTRICT" });
    expect(g.admit("r", 1, { risk: "write", paid: false })).toMatchObject({ ok: true, level: "RESTRICT" });
    expect(g.admit("r", 1, { risk: "read", paid: true })).toMatchObject({ ok: false, level: "RESTRICT" });
    expect(g.admit("r", 1, { risk: "destructive", paid: false }).ok).toBe(false);
    expect(() => g.admit("nope", 1, { risk: "read", paid: false })).toThrow(/no quota/);
    expect(new ResourceGuard({ z: { limit: 0, unit: "usd" } }).admit("z", 0, { risk: "read", paid: false }).ok).toBe(true);
    expect(new ResourceGuard({ z: { limit: 0, unit: "usd" } }).admit("z", 0.001, { risk: "read", paid: true }).ok).toBe(false);
  });
});
