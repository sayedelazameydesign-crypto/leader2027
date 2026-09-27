import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent, TemplateUnderstanding, createAgentContext, loadTaskForResume, replayFromStore, replayRun, type AgentContext, type AgentRunReport, type GoalTemplate } from "@/celia/core/agent/index";
import { ApprovalService, MemoryTaskStore, TASK_TRANSITIONS, assertTransition, verifyArtifact, type PlanStep, type TaskStore } from "@/celia/core/task/index";
import { SqliteTaskStore } from "@/celia/core/task/sqlite-store";
import { CapabilityRegistry, CostGuard, EvidenceGraph, ExecutionGateway, NexaError, ProviderExecution, type Capability, type Entry, type ProviderResult } from "@/celia/nexa/index";

let tick = 0;
const now = () => `2026-09-27T10:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}.000Z`;

const cap = (id: string, over: Partial<Capability> = {}): Capability => ({ id, kind: "tool", provider: "p", risk: "read", costModel: "free", fixedCostUsd: 0, dataClearance: "INTERNAL", readOnly: true, version: "1", trust: "declared", availability: "known", ...over });
const ok = (data: unknown, costUsd = 0): ProviderResult => ({ ok: true, status: 200, summary: "200", costUsd, sideEffects: [], result: data });
const bad = (status: number): ProviderResult => ({ ok: false, status, summary: `${status}`, costUsd: 0, sideEffects: [], result: { status } });

type Script = Record<string, (call: number, args: Record<string, unknown>) => ProviderResult | Error>;
class CrashSignal extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CrashSignal";
  }
}

/** «عملية» واحدة: مزوّد مكتوب + بوابة + سياق فوق مخزن مشترك؛ الاستئناف يبني عملية جديدة فوق الرسم المحفوظ. */
function process_(opts: { store: TaskStore; taskId: string; script: Script; caps: Capability[]; templates: GoalTemplate[]; ctx?: Partial<AgentContext>; resume?: boolean; costCap?: number; available?: string[] }) {
  const { store, taskId } = opts;
  const registry = new CapabilityRegistry();
  for (const c of opts.caps) registry.register(c);
  for (const id of opts.available ?? []) registry.raise(id, "AVAILABLE", "test: proven reachable earlier", now());
  const calls: string[] = [];
  const perOp: Record<string, number> = {};
  const boundary = new ProviderExecution("p-exec", async (op, args) => {
    calls.push(op);
    perOp[op] = (perOp[op] ?? 0) + 1;
    const fn = opts.script[op];
    if (!fn) throw new Error(`no script for ${op}`);
    const r = fn(perOp[op]!, args);
    if (r instanceof Error) throw r;
    return r;
  });
  const load = opts.resume ? loadTaskForResume(store, taskId) : null;
  const gateway = new ExecutionGateway({
    taskId,
    goal: "test",
    registry,
    providers: ["p"],
    boundaries: { p: boundary },
    costGuard: new CostGuard({ perTaskUsd: opts.costCap ?? 0, perAgentUsd: opts.costCap ?? 0, totalUsd: opts.costCap ?? 0 }),
    grants: () => store.grants(taskId),
    onGrantConsumed: (g) => store.saveGrant(taskId, g),
    graph: load?.graph,
    startSeq: load?.startSeq,
    now,
  });
  const ctx = createAgentContext({ agentId: "agent", taskId, registry, gateway, store, approvals: new ApprovalService(store), now, transportCalls: () => calls.length, defaults: { dataClass: "PUBLIC", maxCostUsd: opts.costCap ?? 0 }, ...opts.ctx });
  const agent = new Agent({ ctx, understanding: new TemplateUnderstanding(opts.templates) });
  return { agent, ctx, calls, gateway, load, registry };
}

const threeStep = (bCandidates: PlanStep["candidates"]): GoalTemplate => ({
  id: "t3",
  describe: "three steps",
  matches: () => true,
  contract: { goal: "three-step read-only task", required: ["a_done", "b_done", "c_done"], forbidden: ["paid_use", "ungated_action"] },
  strategy: () => [
    { id: "a", title: "A", establishes: ["a_done"], candidates: [{ capability: "p:a", operation: "a", arguments: {}, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true, has: ["items"] }, artifacts: [{ type: "a-items", from: "items" }] },
    { id: "b", title: "B", establishes: ["b_done"], candidates: bCandidates, expect: { ok: true, minCount: { path: "items", min: 1 } }, artifacts: [{ type: "b-ids", from: "items[*].id", limit: 2 }] },
    { id: "c", title: "C", establishes: ["c_done"], candidates: [{ capability: "p:c", operation: "c", arguments: { ids: { $bind: "b.items[*].id", limit: 2 } }, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true } },
  ],
});
const script3: Script = { a: () => ok({ items: [1, 2] }), b1: () => bad(401), b2: () => ok({ items: [{ id: "x" }, { id: "y" }, { id: "z" }] }), c: (_n, args) => ok({ got: args.ids }) };
const caps3 = [cap("p:a"), cap("p:b1"), cap("p:b2"), cap("p:c")];
const tpl3 = threeStep([
  { capability: "p:b1", operation: "b1", arguments: {}, risk: "read", dataClass: "PUBLIC" },
  { capability: "p:b2", operation: "b2", arguments: {}, risk: "read", dataClass: "PUBLIC" },
]);

describe("Celia GEN-3 · decisive test 1: process killed during EXECUTING → restart → resume from the checkpoint → same result as an uninterrupted run", () => {
  it("SQLite file survives the crash; the resumed process records the interruption, retries the read, and ends COMPLETED with identical facts and artifacts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "celia-gen3-"));
    const file = path.join(dir, "celia.sqlite");
    const taskId = "task:crash";
    // process 1: crash right after the EXECUTING checkpoint of the 3rd attempt (b2, after the b1 failure + replan)
    const store1 = new SqliteTaskStore(file);
    let executing = 0;
    const p1 = process_({ store: store1, taskId, script: script3, caps: caps3, templates: [tpl3], ctx: { onTransition: (_t, to) => { if (to === "EXECUTING" && ++executing === 3) throw new CrashSignal("SIGKILL"); } } });
    await expect(p1.agent.run({ text: "three" })).rejects.toBeInstanceOf(CrashSignal);
    expect(p1.calls).toEqual(["a", "b1"]); // b2 never reached the provider in process 1
    const snap1 = store1.loadTask(taskId)!;
    expect(snap1.state).toBe("EXECUTING");
    expect(store1.checkpoints(taskId).at(-1)).toMatchObject({ state: "EXECUTING", stepId: "b" });
    expect(snap1.processes).toHaveLength(1);
    expect(snap1.processes[0]!.endedAt).toBeNull(); // the crash left the process record open — honest
    store1.close();

    // process 2: fresh everything except the file
    const store2 = new SqliteTaskStore(file);
    const p2 = process_({ store: store2, taskId, script: script3, caps: caps3, templates: [tpl3], resume: true });
    expect(p2.load!.startSeq).toBe(2); // act-1 (a) and act-2 (b1) were persisted; new actions continue at act-3
    const resumed = await p2.agent.resume(p2.load!.task);
    const t = resumed.task;
    expect(t.state).toBe("COMPLETED");
    expect(t.processes.map((p) => [p.mode, p.fromState, p.toState])).toEqual([["run", "CREATED", null], ["resume", "EXECUTING", "COMPLETED"]]);
    expect(t.steps[1]!.attempts.map((a) => a.outcome)).toEqual(["EXECUTED", "INTERRUPTED", "EXECUTED"]);
    expect(t.steps[1]!.attempts[1]).toMatchObject({ verdict: "FAILED", reason: expect.stringMatching(/INTERRUPTED: process ended after EXECUTING/), failureClass: "transient" });
    expect(p2.calls).toEqual(["b2", "c"]); // the interrupted read was retried once (same candidate), then c
    expect(t.history.slice(snap1.history.length).map((h) => h.to).slice(0, 4)).toEqual(["OBSERVING", "VERIFYING", "RECOVERING", "EXECUTING"]); // resume continues the recorded EXECUTING
    expect(resumed.receipts.map((r) => r.actionId)).toEqual(["action:act-3", "action:act-4"]);

    // the uninterrupted reference run
    const ref = process_({ store: new MemoryTaskStore(), taskId: "task:ref", script: script3, caps: caps3, templates: [tpl3] });
    const reference = await ref.agent.run({ text: "three" });
    expect(t.outcome).toEqual(reference.task.outcome);
    expect(t.facts).toEqual(reference.task.facts);
    expect(t.steps.map((s) => s.status)).toEqual(reference.task.steps.map((s) => s.status));
    expect(t.replans).toBe(reference.task.replans);
    expect(store2.artifacts(taskId).map((a) => [a.type, a.data])).toEqual(ref.ctx.store!.artifacts("task:ref").map((a) => [a.type, a.data]));
    expect(t.attempts).toBe(reference.task.attempts + 1); // exactly one extra: the recorded interruption

    // replay from the store itself
    const { result } = replayFromStore(store2, taskId);
    expect(result.problems).toEqual([]);
    expect(result.gate).toMatchObject({ runtime: "PASS", replan_verified: true, all_actions_gated: true });
    expect(result.gen3).toEqual({ persistence_verified: true, resume_verified: true, approval_flow_verified: "tests", partial_verified: true, artifacts_verified: true, runtime: "PASS" });
    store2.close();

    // integrity: a tampered stored checkpoint refuses to resume
    const store3 = new SqliteTaskStore(file);
    const cps = store3.checkpoints(taskId);
    expect(cps.length).toBeGreaterThan(20);
    const s4 = new SqliteTaskStore(":memory:");
    s4.saveTask({ ...store3.loadTask(taskId)!, state: "EXECUTING" });
    for (const c of cps) s4.appendCheckpoint(c);
    s4.appendEvidence(taskId, store3.evidence(taskId));
    expect(() => loadTaskForResume(s4, taskId)).toThrow(/RESUME_INTEGRITY|task snapshot says/);
    store3.close();
  });
});

const paidTemplate = (alt: boolean): GoalTemplate => ({
  id: "paid",
  describe: "",
  matches: () => true,
  contract: { goal: "paid read", required: ["free_done", "paid_done"], forbidden: ["ungated_action"] },
  strategy: () => [
    { id: "free", title: "F", establishes: ["free_done"], candidates: [{ capability: "p:free", operation: "free", arguments: {}, risk: "read", dataClass: "PUBLIC" }], expect: { ok: true } },
    {
      id: "paid",
      title: "P",
      establishes: ["paid_done"],
      candidates: [
        { capability: "p:paid", operation: "paid", arguments: { q: "x" }, risk: "read", dataClass: "PUBLIC", maxCostUsd: 0.01 },
        ...(alt ? [{ capability: "p:alt", operation: "alt", arguments: {}, risk: "read" as const, dataClass: "PUBLIC" as const }] : []),
      ],
      expect: { ok: true },
    },
  ],
});
const paidCaps = [cap("p:free"), cap("p:paid", { costModel: "fixed", fixedCostUsd: 0.001 }), cap("p:alt")];
const paidScript: Script = { free: () => ok({}), paid: () => ok({ paid: true }, 0.001), alt: () => ok({ alt: true }) };

describe("Celia GEN-3 · decisive test 2: a step needs NEXA_A_PAID with no grant → WAITING_APPROVAL → human approval → resume → COMPLETED", () => {
  it("pauses before EXECUTING, persists the approval request, and after a human grant executes exactly once with basis=grant", async () => {
    const store = new MemoryTaskStore();
    const taskId = "task:approve";
    const p1 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(false)], costCap: 0.01 });
    const first = await p1.agent.run({ text: "go" });
    expect(first.task.state).toBe("WAITING_APPROVAL");
    expect(first.task.history.map((h) => h.to).slice(-2)).toEqual(["READY", "WAITING_APPROVAL"]);
    expect(p1.calls).toEqual(["free"]); // the paid provider call never happened
    expect(first.approvals).toHaveLength(1);
    const a = first.approvals[0]!;
    expect(a).toMatchObject({ status: "pending", stepId: "paid", operation: "paid", costCap: 0.01, reason: expect.stringMatching(/NEXA_A_PAID/) });
    expect(store.pendingApprovals().map((x) => x.id)).toEqual([a.id]);

    // only a human can approve
    const approvals = new ApprovalService(store);
    expect(() => approvals.approve(a.id, { decidedBy: "planner", principal: "agent", now: now() })).toThrow(NexaError);
    expect(() => approvals.approve(a.id, { decidedBy: "", principal: "human", now: now() })).toThrow(/decidedBy/);
    const { grant } = approvals.approve(a.id, { decidedBy: "owner", principal: "human", now: now() });
    expect(grant).toMatchObject({ principal: "human", singleUse: true, maxCostUsd: 0.01, scope: { capability: "p:paid", operation: "paid", proposalHash: a.proposalHash } });
    expect(store.auditLog(taskId).map((e) => e.event)).toEqual(["approval.requested", "approval.approved"]);

    // resume: binding re-verified (hash + operation + cap) then READY → EXECUTING via the gateway with the grant
    const p2 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(false)], costCap: 0.01, resume: true });
    const done = await p2.agent.resume(p2.load!.task);
    expect(done.task.state).toBe("COMPLETED");
    expect(done.task.history.slice(first.task.history.length).map((h) => h.to).slice(0, 3)).toEqual(["READY", "EXECUTING", "OBSERVING"]);
    expect(p2.calls).toEqual(["paid"]);
    expect(done.receipts[0]).toMatchObject({ operation: "paid", outcome: "EXECUTED", basis: "grant", cost: 0.001 });
    expect(store.grants(taskId)[0]!.usedAt).not.toBeNull(); // single-use grant consumed
    expect(done.task.facts.paid_use).toBe(true);
    expect(store.auditLog(taskId).map((e) => e.event)).toEqual(["approval.requested", "approval.approved", "approval.resumed"]);
    const { result } = replayFromStore(store, taskId);
    expect(result.gen3).toMatchObject({ approval_flow_verified: true, resume_verified: true, persistence_verified: true, partial_verified: true });
    expect(result.problems).toEqual([]);

    // a second resume of a finished task is a no-op
    const p3 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(false)], costCap: 0.01, resume: true });
    const again = await p3.agent.resume(p3.load!.task);
    expect(again.task.state).toBe("COMPLETED");
    expect(p3.calls).toEqual([]);
  });
});

describe("Celia GEN-3 · decisive test 3: same scenario + rejection / expiry / tampering → REPLANNING or BLOCKED — never a silent continuation", () => {
  it("rejected ⇒ the paid candidate is never executed; with an alternative the task completes through it, without one it ends PARTIAL", async () => {
    for (const alt of [true, false]) {
      const store = new MemoryTaskStore();
      const taskId = `task:reject-${alt ? "alt" : "noalt"}`;
      // p:paid is AVAILABLE (proven reachable) so the planner ranks it before the free-but-unproven alternative
      const p1 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(alt)], costCap: 0.01, available: ["p:paid"] });
      const first = await p1.agent.run({ text: "go" });
      expect(first.task.state).toBe("WAITING_APPROVAL");
      new ApprovalService(store).reject(first.approvals[0]!.id, { decidedBy: "owner", principal: "human", now: now(), reason: "not now" });
      const p2 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(alt)], costCap: 0.01, resume: true, available: ["p:paid"] });
      const done = await p2.agent.resume(p2.load!.task);
      expect(p2.calls).not.toContain("paid");
      expect(done.task.history.slice(first.task.history.length).map((h) => h.to).slice(0, 2)).toEqual(["REPLANNING", "READY"]);
      expect(done.task.steps[1]!.attempts[0]).toMatchObject({ outcome: "DENIED", deniedAt: "APPROVAL", reason: expect.stringMatching(/rejected: not now/) });
      if (alt) {
        expect(done.task.state).toBe("COMPLETED");
        expect(p2.calls).toEqual(["alt"]);
      } else {
        expect(done.task.state).toBe("PARTIAL");
        expect(done.task.outcome).toMatchObject({ status: "PARTIAL", met: ["free_done"], unmet: ["paid_done"] });
        expect(p2.calls).toEqual([]);
      }
      const { result } = replayFromStore(store, taskId);
      expect(result.gen3.approval_flow_verified).toBe(true);
      expect(result.problems).toEqual([]);
    }
  });

  it("expired ⇒ fail-closed on resume; tampered approval binding ⇒ denied on resume; approving twice is refused", async () => {
    const store = new MemoryTaskStore();
    const taskId = "task:expire";
    const p1 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(true)], costCap: 0.01, ctx: { approvalTtlMs: 1000 }, available: ["p:paid"] });
    const first = await p1.agent.run({ text: "go" });
    const id = first.approvals[0]!.id;
    const late = new Date(Date.parse(first.approvals[0]!.expiresAt) + 1).toISOString();
    expect(() => new ApprovalService(store).approve(id, { decidedBy: "owner", principal: "human", now: late })).toThrow(/expired/);
    const p2 = process_({ store, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(true)], costCap: 0.01, resume: true, ctx: { now: () => late }, available: ["p:paid"] });
    const done = await p2.agent.resume(p2.load!.task);
    expect(done.task.state).toBe("COMPLETED");
    expect(p2.calls).toEqual(["alt"]);
    expect(store.approval(id)?.status).toBe("expired");

    const store2 = new MemoryTaskStore();
    const q1 = process_({ store: store2, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(true)], costCap: 0.01, available: ["p:paid"] });
    const w = await q1.agent.run({ text: "go" });
    const a = store2.approval(w.approvals[0]!.id)!;
    store2.saveApproval({ ...a, proposalHash: "deadbeef" }); // tampered binding
    const svc = new ApprovalService(store2);
    svc.approve(a.id, { decidedBy: "owner", principal: "human", now: now() });
    expect(() => svc.approve(a.id, { decidedBy: "owner", principal: "human", now: now() })).toThrow(/already approved/);
    const q2 = process_({ store: store2, taskId, script: paidScript, caps: paidCaps, templates: [paidTemplate(true)], costCap: 0.01, resume: true, available: ["p:paid"] });
    const d2 = await q2.agent.resume(q2.load!.task);
    expect(q2.calls).toEqual(["alt"]); // the mismatched grant never reached the paid provider
    expect(d2.task.steps[1]!.attempts[0]).toMatchObject({ outcome: "DENIED", deniedAt: "APPROVAL", reason: expect.stringMatching(/does not match the proposal/) });
    expect(store2.auditLog(taskId).map((e) => e.event)).toContain("approval.mismatch");
  });
});

describe("Celia GEN-3 · decisive test 4: partially met contract with no alternatives ⇒ PARTIAL, never COMPLETED; artifacts of verified steps survive", () => {
  it("keeps the verified step's artifact in the store, marks the rest blocked, and the contract (not the agent) says PARTIAL", async () => {
    const store = new SqliteTaskStore(":memory:");
    const taskId = "task:partial";
    const tpl = threeStep([{ capability: "p:b1", operation: "b1", arguments: {}, risk: "read", dataClass: "PUBLIC" }]);
    const p = process_({ store, taskId, script: script3, caps: caps3, templates: [tpl] });
    const r = await p.agent.run({ text: "three" });
    expect(r.task.state).toBe("PARTIAL");
    expect(r.task.outcome).toMatchObject({ status: "PARTIAL", met: ["a_done"], unmet: ["b_done", "c_done"] });
    expect(r.task.steps.map((s) => s.status)).toEqual(["VERIFIED", "BLOCKED", "BLOCKED"]);
    const arts = store.artifacts(taskId);
    expect(arts.map((a) => [a.stepId, a.type, a.data])).toEqual([["a", "a-items", [1, 2]]]);
    expect(arts.every(verifyArtifact)).toBe(true);
    expect(r.task.artifacts[0]).toMatchObject({ id: "artifact:task:partial:a:a-items", ref: "action:act-1", size: 5 });
    expect(JSON.stringify(r.task.artifacts)).not.toContain('"data"'); // public report carries no artifact data
    const { result } = replayFromStore(store, taskId);
    expect(result.gen3).toMatchObject({ partial_verified: true, artifacts_verified: true, persistence_verified: true });
    // a forged artifact (data changed) fails verification
    const forged = { ...arts[0]!, data: [9] };
    expect(verifyArtifact(forged)).toBe(false);
    store.close();
  });
});

describe("Celia GEN-3 · state machine extension and stores", () => {
  it("WAITING_APPROVAL only from PLANNING/READY; PARTIAL only from VERIFYING; terminal states are final", () => {
    expect(Object.entries(TASK_TRANSITIONS).filter(([, to]) => to.includes("WAITING_APPROVAL")).map(([from]) => from)).toEqual(["PLANNING", "READY"]);
    expect(Object.entries(TASK_TRANSITIONS).filter(([, to]) => to.includes("PARTIAL")).map(([from]) => from)).toEqual(["VERIFYING"]);
    expect(Object.entries(TASK_TRANSITIONS).filter(([, to]) => to.includes("COMPLETED")).map(([from]) => from)).toEqual(["VERIFYING"]);
    expect(() => assertTransition("VERIFYING", "WAITING_APPROVAL")).toThrow(/illegal/);
    expect(() => assertTransition("EXECUTING", "WAITING_APPROVAL")).toThrow(/illegal/);
    expect(() => assertTransition("WAITING_APPROVAL", "EXECUTING")).toThrow(/illegal/);
    for (const s of ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED"] as const) expect(TASK_TRANSITIONS[s]).toEqual([]);
    expect(TASK_TRANSITIONS.WAITING_APPROVAL).toEqual(["READY", "REPLANNING", "BLOCKED"]);
  });

  it("SqliteTaskStore round-trips every record type, appends evidence idempotently, and rolls back a failed transaction", async () => {
    const store = new SqliteTaskStore(":memory:");
    const taskId = "task:rt";
    const p = process_({ store, taskId, script: script3, caps: caps3, templates: [tpl3] });
    const r = await p.agent.run({ text: "three" });
    expect(r.task.state).toBe("COMPLETED");
    expect(store.listTasks()).toEqual([expect.objectContaining({ id: taskId, state: "COMPLETED", checkpointHead: r.task.checkpointHead })]);
    const evidence = store.evidence(taskId);
    expect(evidence.length).toBe(r.graph.length);
    expect(EvidenceGraph.verifyEntries(evidence).ok).toBe(true);
    store.appendEvidence(taskId, evidence); // already stored ⇒ no duplicates
    expect(store.evidence(taskId).length).toBe(evidence.length);
    expect(store.checkpoints(taskId).length).toBe(r.checkpoints.length);
    expect(store.artifacts(taskId).map((a) => a.type)).toEqual(["a-items", "b-ids"]);
    expect(store.artifacts(taskId)[1]!.data).toEqual(["x", "y"]);
    expect(() =>
      store.transaction(() => {
        store.audit({ taskId, at: now(), event: "will.rollback", data: {} });
        throw new Error("boom");
      }),
    ).toThrow(/boom/);
    expect(store.auditLog(taskId).map((e) => e.event)).not.toContain("will.rollback");
    // JSON report and store agree
    const fromJson = replayRun(JSON.parse(JSON.stringify(r)) as AgentRunReport);
    const fromStore = replayFromStore(store, taskId).result;
    expect(fromJson.gate.runtime).toBe("PASS");
    expect(fromJson.gen3.persistence_verified).toBe("unknown"); // durability is only provable from the store
    expect(fromStore.gen3.persistence_verified).toBe(true);
    expect(fromStore.gen3.resume_verified).toBe("unknown"); // not exercised in this run
    store.close();
  });

  it("MemoryTaskStore behaves like the SQLite store for the agent (same states, same artifacts)", async () => {
    const a = process_({ store: new MemoryTaskStore(), taskId: "task:m", script: script3, caps: caps3, templates: [tpl3] });
    const b = process_({ store: new SqliteTaskStore(":memory:"), taskId: "task:m", script: script3, caps: caps3, templates: [tpl3] });
    const ra = await a.agent.run({ text: "three" });
    const rb = await b.agent.run({ text: "three" });
    expect(ra.task.history.map((h) => h.to)).toEqual(rb.task.history.map((h) => h.to));
    expect(a.ctx.store!.artifacts("task:m").map((x) => x.data)).toEqual(b.ctx.store!.artifacts("task:m").map((x) => x.data));
    const entries: Entry[] = a.ctx.store!.evidence("task:m");
    expect(entries.length).toBe(b.ctx.store!.evidence("task:m").length);
  });
});
