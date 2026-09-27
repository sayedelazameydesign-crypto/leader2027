import { describe, it, expect } from "vitest";
import {
  ACTION_STAGES,
  CAPABILITY_LADDER,
  CapabilityRegistry,
  CostGuard,
  DeniedExecutor,
  NexaError,
  SimulationExecutor,
  advance,
  assertExecutable,
  assertLadderConsistent,
  authorize,
  consumeGrant,
  evaluatePolicy,
  openAction,
  proposalHash,
  raiseLadder,
  runAction,
  type Capability,
  type Grant,
  type Proposal,
} from "@/celia/nexa/index";

const NOW = "2026-09-26T12:00:00.000Z";
const LATER = "2026-09-26T12:00:01.000Z";

const readCap: Capability = { id: "aisa", kind: "connector", provider: "aisa.one", risk: "read", costModel: "free", fixedCostUsd: 0, dataClearance: "INTERNAL", readOnly: true, version: "1", trust: "declared" };
const paidCap: Capability = { ...readCap, id: "aisa:post_tavily_crawl", kind: "tool", costModel: "fixed", fixedCostUsd: 0.24, trust: "unknown" };
const writeCap: Capability = { ...readCap, id: "github", provider: "github.com", risk: "write", readOnly: false, dataClearance: "PRIVATE" };
const destructiveCap: Capability = { ...writeCap, id: "fs", provider: "local", risk: "destructive", dataClearance: "CRITICAL" };

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  intentId: "i1",
  capability: "aisa",
  operation: "search",
  arguments: { query: "x" },
  risk: "read",
  dataClass: "PUBLIC",
  maxCostUsd: 0,
  proposedBy: "agent",
  at: NOW,
  ...over,
});

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "g1",
  grantedBy: "owner",
  role: "owner",
  scope: { capability: "github", operation: null, proposalHash: null },
  maxCostUsd: 1,
  expiresAt: "2027-01-01T00:00:00.000Z",
  singleUse: true,
  usedAt: null,
  ...over,
});

const ctx = (capability: Capability, p: Proposal, over: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) =>
  ({ capability, proposal: p, budgetRemainingUsd: 1, mode: "CLOUD" as const, simulated: false, ...over });

describe("NEXA protocol — stages and capability ladder", () => {
  it("advances one stage at a time and never skips POLICY/AUTHORIZATION/APPROVAL", () => {
    let rec = openAction(proposal());
    expect(rec.stage).toBe("PROPOSAL");
    expect(rec.ladder).toBe("CAN");
    assertLadderConsistent(rec);
    rec = advance(rec, "CAPABILITY", NOW);
    expect(() => advance(rec, "EXECUTION", NOW)).toThrow(/next stage is POLICY/);
    expect(() => advance(rec, "APPROVAL", NOW)).toThrow(NexaError);
    for (const s of ACTION_STAGES.slice(3)) rec = advance(rec, s, NOW);
    expect(rec.stage).toBe("MEMORY");
    expect(() => advance(rec, "MEMORY", NOW)).toThrow(/final stage/);
  });

  it("ladder rises one rung at a time and only with evidence; EXECUTED requires OBSERVATION stage", () => {
    let rec = openAction(proposal());
    expect(() => raiseLadder(rec, "AVAILABLE", "", NOW)).toThrow(/evidence/);
    expect(() => raiseLadder(rec, "AUTHORIZED", "ev", NOW)).toThrow(/one rung/);
    rec = advance(rec, "CAPABILITY", NOW);
    rec = raiseLadder(rec, "AVAILABLE", "evidence:auth", NOW);
    assertLadderConsistent(rec);
    const jumped = { ...rec, ladder: "EXECUTED" as const };
    expect(() => assertLadderConsistent(jumped)).toThrow(/requires stage/);
    expect([...CAPABILITY_LADDER]).toEqual(["CAN", "AVAILABLE", "AUTHORIZED", "EXECUTABLE", "EXECUTED", "VERIFIED"]);
  });

  it("proposalHash binds capability/operation/arguments/cap — not timestamps or ids", () => {
    const a = proposal();
    expect(proposalHash(a)).toBe(proposalHash(proposal({ id: "other", at: LATER, proposedBy: "someone-else" })));
    expect(proposalHash(a)).not.toBe(proposalHash({ ...a, arguments: { query: "y" } }));
    expect(proposalHash(a)).not.toBe(proposalHash({ ...a, maxCostUsd: 0.5 }));
  });
});

describe("NEXA capability registry", () => {
  it("registers once, raises with evidence only, and never skips rungs", () => {
    const reg = new CapabilityRegistry();
    reg.register(readCap);
    expect(() => reg.register(readCap)).toThrow(/already registered/);
    expect(() => reg.raise("aisa", "AUTHORIZED", "ev", NOW)).toThrow(/LADDER_ORDER|expected/);
    expect(() => reg.raise("aisa", "AVAILABLE", "", NOW)).toThrow(/evidence/);
    expect(reg.raise("aisa", "AVAILABLE", "evidence:auth", NOW).state).toBe("AVAILABLE");
    expect(() => reg.reset("aisa", "AUTHORIZED", "x", NOW)).toThrow(/lower/);
    expect(reg.reset("aisa", "CAN", "auth rejected", LATER).evidence.at(-1)?.ref).toMatch(/reset: auth rejected/);
    expect(() => reg.get("nope")).toThrow(/not registered/);
  });
});

describe("NEXA policy", () => {
  it("admits a free read-only action with PUBLIC data", () => {
    const d = evaluatePolicy(ctx(readCap, proposal()));
    expect(d.decision).toBe("ADMIT");
    expect(d.findings).toEqual([]);
  });

  it("denies when data class exceeds provider clearance, and enforces LOCAL/HYBRID privacy modes", () => {
    expect(evaluatePolicy(ctx(readCap, proposal({ dataClass: "SECRET" }))).decision).toBe("DENY");
    expect(evaluatePolicy(ctx(readCap, proposal({ dataClass: "INTERNAL" }), { mode: "LOCAL" })).findings.map((f) => f.reason).join()).toMatch(/LOCAL mode/);
    expect(evaluatePolicy(ctx(readCap, proposal({ dataClass: "PUBLIC" }), { mode: "LOCAL" })).decision).toBe("ADMIT");
    const hybrid = evaluatePolicy(ctx({ ...readCap, dataClearance: "CRITICAL" }, proposal({ dataClass: "PRIVATE" }), { mode: "HYBRID" }));
    expect(hybrid.decision).toBe("DENY");
    expect(evaluatePolicy(ctx({ ...readCap, provider: "local", dataClearance: "PRIVATE" }, proposal({ dataClass: "PRIVATE" }), { mode: "HYBRID" })).decision).toBe("ADMIT");
  });

  it("denies dynamic/unknown cost, fixed cost above the cap or the remaining budget", () => {
    expect(evaluatePolicy(ctx({ ...readCap, costModel: "dynamic" }, proposal())).findings[0]?.reason).toMatch(/no documented upper bound/);
    expect(evaluatePolicy(ctx({ ...readCap, costModel: "unknown" }, proposal())).decision).toBe("DENY");
    const fixed = { ...readCap, costModel: "fixed" as const, fixedCostUsd: 0.24, trust: "declared" as const };
    expect(evaluatePolicy(ctx(fixed, proposal({ maxCostUsd: 0.01 }))).findings.map((f) => f.reason).join()).toMatch(/exceeds proposal cap/);
    expect(evaluatePolicy(ctx(fixed, proposal({ maxCostUsd: 0.5 }), { budgetRemainingUsd: 0.1 })).findings.map((f) => f.reason).join()).toMatch(/remaining budget/);
    expect(evaluatePolicy(ctx(fixed, proposal({ maxCostUsd: 0.5 }))).decision).toBe("ADMIT");
  });

  it("write/admin need approval, understated risk is denied, destructive needs simulation, unknown trust needs approval", () => {
    expect(evaluatePolicy(ctx(writeCap, proposal({ capability: "github", risk: "write" }))).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy(ctx(writeCap, proposal({ capability: "github", risk: "read" }))).findings.map((f) => f.reason).join()).toMatch(/understated/);
    const destructive = proposal({ capability: "fs", risk: "destructive", dataClass: "CRITICAL" });
    expect(evaluatePolicy(ctx(destructiveCap, destructive)).findings.map((f) => f.reason).join()).toMatch(/simulation report/);
    expect(evaluatePolicy(ctx(destructiveCap, destructive, { simulated: true, localProviders: ["local"] })).decision).toBe("REQUIRE_APPROVAL");
    const p = evaluatePolicy(ctx(paidCap, proposal({ capability: paidCap.id, maxCostUsd: 0.01 })));
    expect(p.decision).toBe("DENY");
    expect(p.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(["cost", "trust"]));
    expect(evaluatePolicy(ctx({ ...paidCap, fixedCostUsd: 0.001 }, proposal({ capability: paidCap.id, maxCostUsd: 0.01 }))).decision).toBe("REQUIRE_APPROVAL");
  });
});

describe("NEXA authorization — grants are scoped, single-use, hash-bound", () => {
  const write = proposal({ capability: "github", operation: "git.push", risk: "write", maxCostUsd: 0 });
  const requireApproval = evaluatePolicy(ctx(writeCap, write));

  it("policy DENY can never be overridden by a grant", () => {
    const denied = evaluatePolicy(ctx(writeCap, proposal({ capability: "github", risk: "read" })));
    expect(denied.decision).toBe("DENY");
    const r = authorize(write, denied, [grant()], NOW);
    expect(r.authorized).toBe(false);
    expect(r.reasons[0]).toBe("policy denied");
  });

  it("read + ADMIT needs no grant; write + ADMIT (misconfigured rules) is refused", () => {
    const admit = evaluatePolicy(ctx(readCap, proposal()));
    expect(authorize(proposal(), admit, [], NOW)).toMatchObject({ authorized: true, basis: "policy", stamp: null });
    expect(authorize(write, { decision: "ADMIT", findings: [] }, [grant()], NOW).authorized).toBe(false);
  });

  it("matches only a valid grant: capability, operation, proposal hash, expiry, cap, single-use", () => {
    expect(authorize(write, requireApproval, [], NOW).authorized).toBe(false);
    expect(authorize(write, requireApproval, [grant({ scope: { capability: "aisa", operation: null, proposalHash: null } })], NOW).reasons.join()).toMatch(/capability mismatch/);
    expect(authorize(write, requireApproval, [grant({ scope: { capability: "github", operation: "git.force-push", proposalHash: null } })], NOW).reasons.join()).toMatch(/operation mismatch/);
    expect(authorize(write, requireApproval, [grant({ scope: { capability: "github", operation: null, proposalHash: "deadbeef" } })], NOW).reasons.join()).toMatch(/different proposal/);
    expect(authorize(write, requireApproval, [grant({ expiresAt: NOW })], NOW).reasons.join()).toMatch(/expired/);
    expect(authorize(write, requireApproval, [grant({ usedAt: NOW })], NOW).reasons.join()).toMatch(/already consumed/);
    expect(authorize(proposal({ ...write, maxCostUsd: 5 }), requireApproval, [grant({ maxCostUsd: 1 })], NOW).reasons.join()).toMatch(/cap 1 < proposal 5/);
    const bound = grant({ scope: { capability: "github", operation: "git.push", proposalHash: proposalHash(write) } });
    const ok = authorize(write, requireApproval, [bound], NOW);
    expect(ok).toMatchObject({ authorized: true, basis: "grant" });
    expect(ok.stamp).toMatchObject({ grantId: "g1", approvedBy: "owner", proposalHash: proposalHash(write) });
    const used = consumeGrant(bound, NOW);
    expect(() => consumeGrant(used, LATER)).toThrow(/already consumed/);
    expect(authorize(write, requireApproval, [used], LATER).authorized).toBe(false);
  });
});

describe("NEXA cost guard", () => {
  it("enforces per-task, per-agent and total caps; settle cannot exceed reservation", () => {
    const g = new CostGuard({ perTaskUsd: 0.01, perAgentUsd: 0.015, totalUsd: 0.02 });
    expect(g.reserve("t1", "a1", 0.24, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/task budget/) });
    const r1 = g.reserve("t1", "a1", 0.01, NOW);
    expect(r1.ok).toBe(true);
    expect(g.reserve("t1", "a1", 0.001, NOW).ok).toBe(false);
    expect(g.reserve("t2", "a1", 0.01, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/agent budget/) });
    if (!r1.ok) throw new Error("unreachable");
    expect(() => g.settle(r1.reservation.id, 0.02, NOW)).toThrow(/OVERSPEND|exceeds reserved/);
    g.settle(r1.reservation.id, 0.004, NOW);
    expect(g.remaining("t1", "a1").task).toBeCloseTo(0.006, 6);
    const r2 = g.reserve("t2", "a2", 0.01, NOW);
    if (!r2.ok) throw new Error("unreachable");
    expect(g.reserve("t3", "a3", 0.01, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/total budget/) });
    g.release(r2.reservation.id, NOW);
    expect(g.reserve("t3", "a3", 0.01, NOW).ok).toBe(true);
    expect(g.entries().map((e) => e.event)).toEqual(["refuse", "reserve", "refuse", "refuse", "settle", "reserve", "refuse", "release", "reserve"]);
  });
});

describe("NEXA execution boundary", () => {
  const admit = evaluatePolicy(ctx(readCap, proposal()));
  const authorized = authorize(proposal(), admit, [], NOW);

  it("default executor refuses everything: a capability existing is not a capability being executable", async () => {
    await expect(runAction(new DeniedExecutor(), { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null })).rejects.toMatchObject({ code: "EXECUTION_NOT_BOUND" });
  });

  it("refuses unauthorized, denied, unapproved-write and unreserved-paid actions before touching the executor", async () => {
    let calls = 0;
    const spy = { id: "spy", mode: "real" as const, execute: async () => { calls++; return { proposalId: "p1", executor: "spy", mode: "real" as const, startedAt: NOW, endedAt: NOW, ok: true, summary: "", sideEffects: [], costUsd: 0, artifacts: [] }; } };
    const base = { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null };
    await expect(runAction(spy, { ...base, policy: { decision: "DENY", findings: [] } })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(runAction(spy, { ...base, authorization: { ...authorized, authorized: false } })).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(runAction(spy, { ...base, proposal: proposal({ risk: "write" }), policy: { decision: "REQUIRE_APPROVAL", findings: [] } })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(runAction(spy, { ...base, proposal: proposal({ maxCostUsd: 0.01 }) })).rejects.toMatchObject({ code: "NO_RESERVATION" });
    expect(calls).toBe(0);
    expect(() => assertExecutable(base)).not.toThrow();
    await runAction(spy, base);
    expect(calls).toBe(1);
  });

  it("rejects observations that contradict the proposal (side effects on read, cost above cap)", async () => {
    const dirty = { id: "dirty", mode: "real" as const, execute: async () => ({ proposalId: "p1", executor: "dirty", mode: "real" as const, startedAt: NOW, endedAt: NOW, ok: true, summary: "", sideEffects: ["wrote file"], costUsd: 0, artifacts: [] }) };
    await expect(runAction(dirty, { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null })).rejects.toMatchObject({ code: "SIDE_EFFECTS_ON_READ" });
    const pricey = { ...dirty, execute: async () => ({ proposalId: "p1", executor: "dirty", mode: "real" as const, startedAt: NOW, endedAt: NOW, ok: true, summary: "", sideEffects: [], costUsd: 0.5, artifacts: [] }) };
    await expect(runAction(pricey, { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null })).rejects.toMatchObject({ code: "COST_CAP_BREACH" });
  });

  it("simulation measures impact and blocks destructive scope or production references", async () => {
    const blocked = new SimulationExecutor("sim", () => ({ affected: 12, dependenciesImpacted: 3, productionReferences: 1, destructive: false, notes: [] }));
    const obs = await runAction(blocked, { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null }, () => NOW);
    expect(obs.ok).toBe(false);
    expect(obs.summary).toMatch(/12 affected, 3 dependencies impacted, 1 production reference\(s\) — EXECUTION BLOCKED/);
    expect(obs.sideEffects).toEqual([]);
    const allowed = new SimulationExecutor("sim", () => ({ affected: 2, dependenciesImpacted: 0, productionReferences: 0, destructive: false, notes: [] }));
    expect((await runAction(allowed, { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null }, () => NOW)).ok).toBe(true);
    const destructive = new SimulationExecutor("sim", () => ({ affected: 1, dependenciesImpacted: 0, productionReferences: 0, destructive: true, notes: [] }));
    expect((await runAction(destructive, { proposal: proposal(), policy: admit, authorization: authorized, reservationId: null }, () => NOW)).summary).toMatch(/destructive scope/);
  });
});
