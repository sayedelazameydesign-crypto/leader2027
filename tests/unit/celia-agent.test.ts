import { describe, it, expect } from "vitest";
import {
  Agent,
  TemplateUnderstanding,
  createAgentContext,
  replayRun,
  resolveArguments,
  selectPath,
  type AgentContext,
  type AgentRunReport,
  type GoalTemplate,
} from "@/celia/core/agent/index";
import {
  MemoryCheckpointStore,
  TASK_TRANSITIONS,
  assertTransition,
  createTask,
  makeCheckpoint,
  transition,
  verifyCheckpoints,
  type PlanStep,
} from "@/celia/core/task/index";
import { CapabilityRegistry, CostGuard, ExecutionGateway, ProviderExecution, type Capability, type ProviderResult } from "@/celia/nexa/index";

let tick = 0;
const now = () => `2026-09-26T12:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z`;

const cap = (id: string, over: Partial<Capability> = {}): Capability => ({ id, kind: "tool", provider: "p", risk: "read", costModel: "free", fixedCostUsd: 0, dataClearance: "INTERNAL", readOnly: true, version: "1", trust: "declared", availability: "known", ...over });

type ProviderScript = Record<string, (call: number, args: Record<string, unknown>) => ProviderResult | Error>;

/** بيئة اختبار: مزوّد مكتوب بالسيناريو خلف حدّ تنفيذ حقيقي + بوابة حقيقية + سجل قدرات. */
function world(script: ProviderScript, caps: Capability[], templates: GoalTemplate[], ctxOver: Partial<AgentContext> = {}) {
  const registry = new CapabilityRegistry();
  for (const c of caps) registry.register(c);
  const calls: string[] = [];
  const perOp: Record<string, number> = {};
  const boundary = new ProviderExecution("p-exec", async (op, args) => {
    calls.push(op);
    perOp[op] = (perOp[op] ?? 0) + 1;
    const fn = script[op];
    if (!fn) throw new Error(`no script for ${op}`);
    const r = fn(perOp[op]!, args);
    if (r instanceof Error) throw r;
    return r;
  });
  const gateway = new ExecutionGateway({ taskId: "task:t", goal: "test", registry, providers: ["p"], boundaries: { p: boundary }, costGuard: new CostGuard({ perTaskUsd: 0, perAgentUsd: 0, totalUsd: 0 }), now });
  const checkpoints = new MemoryCheckpointStore();
  const ctx = createAgentContext({ agentId: "agent", taskId: "task:t", registry, gateway, checkpoints, now, transportCalls: () => calls.length, ...ctxOver });
  const agent = new Agent({ ctx, understanding: new TemplateUnderstanding(templates) });
  return { agent, ctx, calls, gateway, registry };
}

const ok = (data: unknown): ProviderResult => ({ ok: true, status: 200, summary: "200", costUsd: 0, sideEffects: [], result: data });
const bad = (status: number): ProviderResult => ({ ok: false, status, summary: `${status}`, costUsd: 0, sideEffects: [], result: { status } });

const threeStepTemplate = (discoverCandidates: PlanStep["candidates"]): GoalTemplate => ({
  id: "t3",
  describe: "three steps",
  matches: (g) => /three/i.test(g.text),
  contract: { goal: "three-step read-only task", required: ["a_done", "b_done", "c_done"], forbidden: ["paid_use", "ungated_action"] },
  strategy: () => [
    { id: "a", title: "A", establishes: ["a_done"], candidates: [{ capability: "p:a", operation: "a", arguments: {}, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true, has: ["items"] } },
    { id: "b", title: "B", establishes: ["b_done"], candidates: discoverCandidates, expect: { ok: true, minCount: { path: "items", min: 1 } } },
    { id: "c", title: "C", establishes: ["c_done"], candidates: [{ capability: "p:c", operation: "c", arguments: { ids: { $bind: "b.items[*].id", limit: 2 } }, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true } },
  ],
});

describe("Celia GEN-2 · decisive scenario 1: step 1 PASS → step 2 FAIL → observe → replan → alternative PASS → step 3 PASS → COMPLETED", () => {
  it("runs the state machine end to end, every action through the gateway, contract decides COMPLETED, replay PASSes", async () => {
    const template = threeStepTemplate([
      { capability: "p:b1", operation: "b1", arguments: {}, risk: "read", dataClass: "PUBLIC" },
      { capability: "p:b2", operation: "b2", arguments: {}, risk: "read", dataClass: "PUBLIC" },
    ]);
    const w = world(
      { a: () => ok({ items: [1] }), b1: () => bad(401), b2: () => ok({ items: [{ id: "x" }, { id: "y" }, { id: "z" }] }), c: (_n, args) => ok({ got: args.ids }) },
      [cap("p:a"), cap("p:b1"), cap("p:b2"), cap("p:c")],
      [template],
    );
    const report = await w.agent.run({ text: "do the three step thing" });
    const t = report.task;
    expect(t.state).toBe("COMPLETED");
    expect(t.outcome?.status).toBe("COMPLETED");
    expect(t.replans).toBe(1);
    expect(t.plans.map((p) => p.version)).toEqual([1, 2]);
    expect(t.plans[1]!.rejected).toEqual([{ stepId: "b", capability: "p:b1", operation: "b1", reason: expect.stringMatching(/exhausted: permanent failure/) }]);
    expect(w.calls).toEqual(["a", "b1", "b2", "c"]); // b1 tried once, never retried (permanent), alternative used, binding resolved from b2
    expect(t.steps.map((s) => s.status)).toEqual(["VERIFIED", "VERIFIED", "VERIFIED"]);
    expect(t.steps[1]!.attempts.map((a) => a.verdict)).toEqual(["FAILED", "VERIFIED"]);
    expect(t.history.map((h) => h.to)).toEqual([
      "UNDERSTANDING", "PLANNING", "READY",
      "EXECUTING", "OBSERVING", "VERIFYING", "READY",
      "EXECUTING", "OBSERVING", "VERIFYING", "RECOVERING", "REPLANNING", "READY",
      "EXECUTING", "OBSERVING", "VERIFYING", "READY",
      "EXECUTING", "OBSERVING", "VERIFYING", "READY",
      "VERIFYING", "COMPLETED",
    ]);
    // binding: c received the first two ids from b2's verified observation
    expect(w.gateway.receipts().find((r) => r.operation === "c")?.observation?.result).toEqual({ got: ["x", "y"] });
    // gateway is the only path: attempts == receipts == transport calls
    expect(report.gateway).toMatchObject({ submitted: 4, executed: 4, transport_calls: 4, ungated_calls: 0 });
    expect(report.receipts.every((r) => r.cost === 0)).toBe(true);
    // replay from the serialized report alone
    const replay = replayRun(JSON.parse(JSON.stringify(report)) as AgentRunReport);
    expect(replay.problems).toEqual([]);
    expect(replay.gate).toEqual({ agent_goal_verified: true, outcome_contract_verified: true, all_actions_gated: true, replan_verified: true, evidence_chain_valid: true, no_paid_operation: true, runtime: "PASS" });
    expect(report.checkpoints.length).toBe(t.history.length + 1);
    expect(report.lines.join("\n")).toMatch(/STEP b: attempt 2 plan=v1 p:b1\/b1 -> action:act-2 EXECUTED ok=false => FAILED/);
  });
});

describe("Celia GEN-2/3 · decisive scenario 2: tool unavailable → replan → alternative unavailable → step blocked → contract says PARTIAL (never COMPLETED)", () => {
  it("blocks the step and its dependents, keeps what was established, and ends PARTIAL by the contract with the denials as evidence", async () => {
    const template = threeStepTemplate([
      { capability: "p:b1", operation: "b1", arguments: {}, risk: "read", dataClass: "PUBLIC" },
      { capability: "q:b2", operation: "b2", arguments: {}, risk: "read", dataClass: "PUBLIC" }, // provider q has no bound boundary
    ]);
    const w = world({ a: () => ok({ items: [1] }), b1: () => bad(503), b2: () => ok({ items: [1] }) }, [cap("p:a"), cap("p:b1"), cap("q:b2", { provider: "q" }), cap("p:c")], [template], { limits: { maxReplans: 3, maxRetriesPerStep: 1, maxAttempts: 20 }, classifyFailure: () => "transient" });
    const report = await w.agent.run({ text: "three" });
    const t = report.task;
    expect(t.state).toBe("PARTIAL"); // GEN-3: PARTIAL is decided by the contract at VERIFYING, never by the agent
    expect(t.outcome).toMatchObject({ status: "PARTIAL", met: ["a_done"], unmet: ["b_done", "c_done"] });
    expect(t.blockedReason).toMatch(/no alternative capability for step "b"/);
    expect(w.calls).toEqual(["a", "b1", "b1"]); // 503 is transient ⇒ one retry, then replan; q:b2 denied at CAPABILITY (unknown provider) ⇒ provider never called
    const denied = report.receipts.filter((r) => r.outcome === "DENIED");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ operation: "b2", deniedAt: "CAPABILITY" });
    expect(t.steps.map((s) => s.status)).toEqual(["VERIFIED", "BLOCKED", "BLOCKED"]); // c binds b.items ⇒ blocked by dependency, no attempt made
    expect(t.steps[2]!.attempts).toEqual([expect.objectContaining({ outcome: "ERROR", reason: expect.stringMatching(/dependency "b" blocked/) })]);
    expect(t.history.map((h) => h.to).slice(-6)).toEqual(["VERIFYING", "RECOVERING", "REPLANNING", "READY", "VERIFYING", "PARTIAL"]);
    const replay = replayRun(JSON.parse(JSON.stringify(report)) as AgentRunReport);
    expect(replay.gate.outcome_contract_verified).toBe(false);
    expect(replay.gate.evidence_chain_valid).toBe(true);
    expect(replay.gate.all_actions_gated).toBe(true);
    expect(replay.gen3.partial_verified).toBe(true);
    expect(replay.problems).toEqual([]);
  });
});

describe("Celia GEN-2 · decisive scenario 3: cost unknown → NEXA DENY → provider never called", () => {
  it("a dynamic-cost capability is denied at POLICY before the boundary; with no alternative the task is BLOCKED and the boundary count stays 0", async () => {
    const template: GoalTemplate = {
      id: "paid",
      describe: "",
      matches: () => true,
      contract: { goal: "g", required: ["x_done"], forbidden: ["paid_use"] },
      strategy: () => [{ id: "x", title: "X", establishes: ["x_done"], candidates: [{ capability: "p:dyn", operation: "dyn", arguments: {}, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true } }],
    };
    const w = world({ dyn: () => ok({}) }, [cap("p:dyn", { costModel: "dynamic", fixedCostUsd: null })], [template]);
    const report = await w.agent.run({ text: "anything" });
    expect(w.calls).toEqual([]);
    expect(report.gateway.executed).toBe(0);
    expect(report.receipts).toHaveLength(1);
    expect(report.receipts[0]).toMatchObject({ operation: "dyn", outcome: "DENIED", deniedAt: "POLICY", policy: "DENY" });
    expect(report.task.steps[0]!.attempts[0]).toMatchObject({ outcome: "DENIED", deniedAt: "POLICY", verdict: "FAILED", codes: ["NEXA_E_COST_UNKNOWN"] });
    expect(report.task.state).toBe("BLOCKED"); // nothing failed, nothing established: denied ⇒ BLOCKED (decided at VERIFYING)
    expect(report.task.outcome?.status).toBe("FAILED"); // the contract's own verdict: required fact false
    expect(report.task.history.map((h) => h.to).slice(-5)).toEqual(["RECOVERING", "REPLANNING", "READY", "VERIFYING", "BLOCKED"]);
    expect(report.task.facts.paid_use).toBe(false);
  });

  it("unknown availability and a paid fixed cost above the 0 cap are also denied before the boundary; a paid cap in the goal is refused at UNDERSTANDING", async () => {
    const template: GoalTemplate = {
      id: "paid2",
      describe: "",
      matches: () => true,
      contract: { goal: "g", required: ["x_done"], forbidden: ["paid_use"] },
      strategy: () => [
        {
          id: "x",
          title: "X",
          establishes: ["x_done"],
          candidates: [
            { capability: "p:unknown-avail", operation: "u", arguments: {}, risk: "read", dataClass: "PUBLIC" },
            { capability: "p:paid", operation: "paid", arguments: {}, risk: "read", dataClass: "PUBLIC" },
          ],
          expect: { ok: true },
        },
      ],
    };
    const w = world({ u: () => ok({}), paid: () => ok({}) }, [cap("p:unknown-avail", { availability: "unknown" }), cap("p:paid", { costModel: "fixed", fixedCostUsd: 0.001 })], [template]);
    const report = await w.agent.run({ text: "x" });
    expect(w.calls).toEqual([]);
    expect(report.receipts.map((r) => [r.operation, r.deniedAt])).toEqual([["u", "POLICY"], ["paid", "POLICY"]]);
    expect(report.task.steps[0]!.attempts.map((a) => a.codes)).toEqual([["NEXA_E_AVAILABILITY_UNKNOWN"], ["NEXA_E_COST_EXCEEDS_CAP", "NEXA_E_COST_EXCEEDS_BUDGET", "NEXA_A_PAID"]]); // budget is 0 too
    expect(report.task.state).toBe("BLOCKED");
    expect(report.task.replans).toBe(2); // candidate 1 denied → replan → candidate 2 denied → replan → nothing left
    // a goal asking for a spend cap above the agent cap is refused before planning — no attempt, no receipt
    const w2 = world({}, [cap("p:paid", { costModel: "fixed", fixedCostUsd: 0.001 })], [template]);
    const r2 = await w2.agent.run({ text: "x", constraints: { maxCostUsd: 0.5 } });
    expect(r2.task.state).toBe("BLOCKED");
    expect(r2.task.blockedReason).toMatch(/GOAL_CONSTRAINT/);
    expect(r2.receipts).toHaveLength(0);
  });
});

describe("Celia GEN-2 · understanding, verification and termination", () => {
  const simple = (expect_: PlanStep["expect"]): GoalTemplate => ({
    id: "s",
    describe: "",
    matches: (g) => /simple/.test(g.text),
    contract: { goal: "g", required: ["s_done"], forbidden: ["paid_use"] },
    strategy: () => [{ id: "s", title: "S", establishes: ["s_done"], candidates: [{ capability: "p:s", operation: "s", arguments: {}, risk: "read", dataClass: "PUBLIC" }], expect: expect_ }],
  });

  it("unknown goal ⇒ BLOCKED at UNDERSTANDING; ambiguous goal ⇒ BLOCKED; explicit templateId disambiguates", async () => {
    const a: GoalTemplate = { ...simple({ ok: true }), id: "a", matches: () => true };
    const b: GoalTemplate = { ...simple({ ok: true }), id: "b", matches: () => true };
    const w = world({ s: () => ok({}) }, [cap("p:s")], [a, b]);
    const amb = await w.agent.run({ text: "whatever" });
    expect(amb.task.state).toBe("BLOCKED");
    expect(amb.task.blockedReason).toMatch(/GOAL_AMBIGUOUS/);
    expect(amb.task.history.map((h) => h.to)).toEqual(["UNDERSTANDING", "BLOCKED"]);
    const w2 = world({ s: () => ok({}) }, [cap("p:s")], [simple({ ok: true })]);
    const none = await w2.agent.run({ text: "nothing matches" });
    expect(none.task.blockedReason).toMatch(/GOAL_NOT_UNDERSTOOD/);
    const w3 = world({ s: () => ok({}) }, [cap("p:s")], [a, b]);
    const picked = await w3.agent.run({ text: "whatever", templateId: "b" });
    expect(picked.task.state).toBe("COMPLETED");
    expect(picked.task.intent?.understoodBy).toBe("template:b");
  });

  it("known blocker facts stop the task before planning (no attempt); executed-but-unexpected ⇒ NOT_VERIFIED ⇒ REPLANNING", async () => {
    const w = world({ s: () => ok({}) }, [cap("p:s")], [{ ...simple({ ok: true }), contract: { goal: "g", required: ["s_done"], forbidden: [], blockers: ["secret_absent"] } }], { facts: { secret_absent: true } });
    const blocked = await w.agent.run({ text: "simple" });
    expect(blocked.task.history.map((h) => h.to)).toEqual(["UNDERSTANDING", "BLOCKED"]);
    expect(blocked.receipts).toHaveLength(0);
    const w2 = world({ s: () => ok({ items: [] }) }, [cap("p:s")], [simple({ ok: true, minCount: { path: "items", min: 1 } })]);
    const nv = await w2.agent.run({ text: "simple" });
    expect(nv.task.steps[0]!.attempts[0]).toMatchObject({ outcome: "EXECUTED", ok: true, verdict: "NOT_VERIFIED", reason: expect.stringMatching(/count 0 < 1/) });
    expect(nv.task.history.map((h) => h.to)).toContain("REPLANNING");
    expect(nv.task.history.map((h) => h.to)).not.toContain("RECOVERING");
    expect(nv.task.state).toBe("BLOCKED");
  });

  it("transient failures retry once then replan; the loop always terminates (replan budget, attempt budget)", async () => {
    const w = world({ s: (n) => (n === 1 ? bad(503) : ok({})) }, [cap("p:s")], [simple({ ok: true })], { classifyFailure: () => "transient" });
    const r = await w.agent.run({ text: "simple" });
    expect(w.calls).toEqual(["s", "s"]);
    expect(r.task.state).toBe("COMPLETED");
    expect(r.task.steps[0]!.retries).toBe(1);
    expect(r.task.replans).toBe(0);
    const w2 = world({ s: () => bad(503) }, [cap("p:s")], [simple({ ok: true })], { classifyFailure: () => "transient", limits: { maxReplans: 3, maxRetriesPerStep: 1, maxAttempts: 20 } });
    const r2 = await w2.agent.run({ text: "simple" });
    expect(r2.task.state).toBe("BLOCKED"); // retry, then replan with no alternative
    expect(w2.calls).toHaveLength(2);
    const w3 = world({ s: () => bad(503) }, [cap("p:s")], [simple({ ok: true })], { classifyFailure: () => "transient", limits: { maxReplans: 3, maxRetriesPerStep: 100, maxAttempts: 5 } });
    const r3 = await w3.agent.run({ text: "simple" });
    expect(r3.task.state).toBe("FAILED");
    expect(r3.task.attempts).toBe(5);
    expect(r3.task.blockedReason).toBeNull();
    expect(r3.task.history.at(-1)?.note).toMatch(/attempt budget 5 exhausted/);
  });

  it("never claims COMPLETED when the contract requires a fact no verified step establishes", async () => {
    const t: GoalTemplate = { ...simple({ ok: true }), contract: { goal: "g", required: ["s_done", "never_established"], forbidden: [] } };
    const w = world({ s: () => ok({}) }, [cap("p:s")], [t]);
    const r = await w.agent.run({ text: "simple" });
    expect(r.task.steps[0]!.status).toBe("VERIFIED");
    expect(r.task.state).toBe("FAILED");
    expect(r.task.outcome).toMatchObject({ status: "NOT_VERIFIED", met: ["s_done"], unknown: ["never_established"] });
  });
});

describe("Celia GEN-2 · task state machine and checkpoints", () => {
  it("only declared transitions are legal; COMPLETED is reachable from VERIFYING alone; terminal states are final", () => {
    expect(() => assertTransition("PLANNING", "COMPLETED")).toThrow(/illegal task transition PLANNING → COMPLETED/);
    expect(() => assertTransition("READY", "COMPLETED")).toThrow();
    expect(() => assertTransition("COMPLETED", "READY")).toThrow(/terminal/);
    expect(Object.entries(TASK_TRANSITIONS).filter(([, to]) => to.includes("COMPLETED")).map(([from]) => from)).toEqual(["VERIFYING"]);
    expect(TASK_TRANSITIONS.EXECUTING).toEqual(["OBSERVING"]);
    const store = new MemoryCheckpointStore();
    const task = createTask("task:x", "a", { text: "g" }, now(), store, "0".repeat(64));
    transition(task, "UNDERSTANDING", { at: now(), note: "u", evidenceHead: "h1", checkpoints: store });
    expect(() => transition(task, "COMPLETED", { at: now(), note: "cheat", evidenceHead: "h2", checkpoints: store })).toThrow(/illegal/);
    expect(task.state).toBe("UNDERSTANDING");
    expect(store.list().map((c) => c.state)).toEqual(["CREATED", "UNDERSTANDING"]);
  });

  it("checkpoints are hash-chained; tampering, gaps, forged transitions and replayed reports are detected", () => {
    const store = new MemoryCheckpointStore();
    const task = createTask("task:x", "a", { text: "g" }, now(), store, "0".repeat(64));
    for (const s of ["UNDERSTANDING", "PLANNING", "READY"] as const) transition(task, s, { at: now(), note: s, evidenceHead: "0".repeat(64), checkpoints: store });
    const list = [...store.list()];
    expect(verifyCheckpoints(list)).toMatchObject({ ok: true, final: "READY", count: 4 });
    const tampered = list.map((c, i) => (i === 2 ? { ...c, note: "edited" } : c));
    expect(verifyCheckpoints(tampered)).toMatchObject({ ok: false, reason: expect.stringMatching(/hash mismatch/) });
    expect(verifyCheckpoints([list[0]!, list[2]!, list[3]!])).toMatchObject({ ok: false, reason: expect.stringMatching(/sequence gap/) });
    const forged = [...list, makeCheckpoint(list.at(-1)!, { taskId: "task:x", at: now(), from: "READY", state: "COMPLETED", planVersion: 1, stepId: null, note: "jump", evidenceHead: "0".repeat(64) })];
    expect(verifyCheckpoints(forged)).toMatchObject({ ok: false, reason: expect.stringMatching(/illegal transition READY → COMPLETED/) });
  });

  it("replay rejects a report whose checkpoint chain or evidence heads were altered, and reports replan as not exercised on a straight run", async () => {
    const template: GoalTemplate = { id: "one", describe: "", matches: () => true, contract: { goal: "g", required: ["o_done"], forbidden: [] }, strategy: () => [{ id: "o", title: "O", establishes: ["o_done"], candidates: [{ capability: "p:o", operation: "o", arguments: {}, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true } }] };
    const w = world({ o: () => ok({}) }, [cap("p:o")], [template]);
    const report = JSON.parse(JSON.stringify(await w.agent.run({ text: "x" }))) as AgentRunReport;
    const clean = replayRun(report);
    expect(clean.gate).toMatchObject({ outcome_contract_verified: true, replan_verified: "unknown", runtime: "NOT_VERIFIED" });
    const tamperedCp = { ...report, checkpoints: report.checkpoints.map((c, i) => (i === 3 ? { ...c, state: "COMPLETED" as const } : c)) };
    expect(replayRun(tamperedCp).gate.evidence_chain_valid).toBe(false);
    const tamperedGraph = { ...report, graph: report.graph.map((e, i) => (i === 2 ? { ...e, at: "1999-01-01T00:00:00.000Z" } : e)) };
    expect(replayRun(tamperedGraph).problems.join()).toMatch(/graph chain broken/);
    const liar = { ...report, task: { ...report.task, facts: { ...report.task.facts, o_done: true }, steps: report.task.steps.map((s) => ({ ...s, status: "FAILED" as const })) } };
    expect(replayRun(liar).problems.join()).toMatch(/without a verified step/);
  });
});

describe("Celia GEN-2 · plan bindings", () => {
  it("selectPath walks objects and maps arrays; resolveArguments binds from verified observations only and fails loudly otherwise", () => {
    const data = { candidates: [{ operation_id: "a", x: 1 }, { operation_id: "b" }, { nope: true }], meta: { n: 3 } };
    expect(selectPath(data, "candidates[*].operation_id")).toEqual(["a", "b"]);
    expect(selectPath(data, "meta.n")).toBe(3);
    expect(selectPath(data, "missing.path")).toBeUndefined();
    expect(selectPath([{ id: 1 }, { id: 2 }], "[*].id")).toEqual([1, 2]);
    const r = resolveArguments({ ids: { $bind: "discover.candidates[*].operation_id", limit: 1 }, nested: { keep: 1, q: { $bind: "discover.meta.n" } }, list: [{ $bind: "discover.meta.n" }] }, { discover: data });
    expect(r.args).toEqual({ ids: ["a"], nested: { keep: 1, q: 3 }, list: [3] });
    expect(r.bound).toEqual(["ids", "nested.q", "list[0]"]);
    expect(() => resolveArguments({ ids: { $bind: "other.x" } }, { discover: data })).toThrow(/no verified observation/);
    expect(() => resolveArguments({ ids: { $bind: "discover.candidates[*].missing" } }, { discover: data })).toThrow(/is empty/);
  });
});
