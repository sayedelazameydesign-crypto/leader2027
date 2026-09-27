/**
 * Celia · core/agent · **الإعادة وبوابتا GEN-2/GEN-3** — بلا شبكة، بلا سرّ، بلا ثقة بالتقرير:
 * تُعاد سلسلة نقاط التفتيش (تسلسل + تجزئة + شرعية الانتقالات)، وسلسلة رسم الدليل، ويُربط كل رأس دليل في النقاط بالرسم،
 * ويُعاد حساب النتيجة من الحقائق والعقد، ويُتحقق أن كل محاولة لها إيصال، وأن النقل الخام = تنفيذات البوابة في كل عملية.
 *
 *   GEN2_GATE = agent_goal_verified ∧ outcome_contract_verified ∧ all_actions_gated ∧ replan_verified ∧ evidence_chain_valid ∧ tests_pass
 *   GEN3_GATE = persistence_verified ∧ resume_verified ∧ approval_flow_verified ∧ partial_verified ∧ artifacts_verified ∧ tests_pass
 *
 * المصدر الأصدق للإعادة هو المخزن نفسه (`--db`): المهمة ونقاطها ودليلها ومخرجاتها كما استقرت على القرص، لا كما رواها التقرير.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceGraph, evaluateOutcome, parseContract, type Entry, type Fact } from "../../nexa/index.ts";
import { CHECKPOINT_GENESIS, verifyArtifact, verifyCheckpoints, type Artifact, type Checkpoint, type TaskState, type TaskStore } from "../task/index.ts";
import { serializeTask, type AgentRunReport } from "./agent.ts";

export type Gen2Gate = {
  agent_goal_verified: Fact;
  outcome_contract_verified: Fact;
  all_actions_gated: Fact;
  replan_verified: Fact;
  evidence_chain_valid: Fact;
  no_paid_operation: Fact;
  runtime: "PASS" | "FAIL" | "NOT_VERIFIED";
};

export type Gen3Gate = {
  persistence_verified: Fact;
  resume_verified: Fact;
  /** true = مورس وتحقق؛ "tests" = لم يُمارَس في هذا التشغيل (تغطيه الاختبارات)؛ false = مورس وفشل. */
  approval_flow_verified: Fact | "tests";
  partial_verified: Fact;
  artifacts_verified: Fact;
  runtime: "PASS" | "FAIL" | "NOT_VERIFIED";
};

export type ReplayResult = {
  ok: boolean;
  gate: Gen2Gate;
  gen3: Gen3Gate;
  problems: string[];
  states: TaskState[];
  checkpoints: number;
  graphEntries: number;
  recomputedOutcome: string | null;
  summary: string[];
};

export type ReplayOptions = { fromStore?: { artifacts: Artifact[] } };

const asFact = (b: boolean | null): Fact => (b === null ? "unknown" : b);

export type GraphReceipt = { actionId: string; capability: string; operation: string; outcome: string; deniedAt: string | null; cost: number; maxCostUsd: number; proposalHash: string; basis: string | null };

/** إيصالات البوابة كما استقرت في رسم الدليل — تغطي كل العمليات (run + resume)، لا العملية الأخيرة فقط. */
export function receiptsFromGraph(entries: readonly Entry[]): GraphReceipt[] {
  const nodes = new Map<string, Record<string, unknown>>();
  for (const e of entries) if (e.kind === "node") nodes.set(e.id, e.data as Record<string, unknown>);
  const out: GraphReceipt[] = [];
  for (const e of entries) {
    if (e.kind !== "node" || !/^action:act-\d+$/.test(e.id)) continue;
    const d = e.data as Record<string, unknown>;
    const obs = nodes.get(`${e.id}:observation`);
    const auth = nodes.get(`${e.id}:authorization`);
    out.push({ actionId: e.id, capability: String(d.capability), operation: String(d.operation), outcome: String(d.outcome), deniedAt: d.deniedAt === null || d.deniedAt === undefined ? null : String(d.deniedAt), cost: Number(obs?.costUsd ?? 0), maxCostUsd: Number(d.maxCostUsd ?? 0), proposalHash: String(d.proposalHash ?? ""), basis: auth ? String(auth.basis) : null });
  }
  return out;
}

export function replayRun(report: AgentRunReport, options: ReplayOptions = {}): ReplayResult {
  const problems: string[] = [];
  const t = report.task;

  // 1) نقاط التفتيش: سلسلة + شرعية + الحالة النهائية = حالة المهمة، وCOMPLETED/PARTIAL لا يسبقهما إلا VERIFYING
  const cps = verifyCheckpoints(report.checkpoints as Checkpoint[]);
  if (!cps.ok) problems.push(`checkpoints: ${cps.reason}`);
  if (cps.ok && cps.final !== t.state) problems.push(`checkpoints end in ${cps.final} but task reports ${t.state}`);
  const states = cps.states;
  for (let i = 1; i < states.length; i++) {
    if ((states[i] === "COMPLETED" || states[i] === "PARTIAL") && states[i - 1] !== "VERIFYING") problems.push(`${states[i]} reached from ${states[i - 1]}`);
    if (states[i] === "WAITING_APPROVAL" && states[i - 1] !== "READY" && states[i - 1] !== "PLANNING") problems.push(`WAITING_APPROVAL reached from ${states[i - 1]}`);
  }
  if (states.includes("COMPLETED") && !states.includes("EXECUTING")) problems.push("COMPLETED without any execution");

  // 2) رسم الدليل: سلسلة سليمة، وكل رأس في نقاط التفتيش موجود في الرسم
  const chain = EvidenceGraph.verifyEntries(report.graph);
  if (!chain.ok) problems.push(`evidence graph chain broken at ${chain.brokenAt}`);
  const hashes = new Set<string>([CHECKPOINT_GENESIS, ...report.graph.map((e) => e.hash)]);
  const missingHeads = report.checkpoints.filter((c) => !hashes.has(c.evidenceHead)).length;
  if (missingHeads) problems.push(`${missingHeads} checkpoint(s) reference an evidence head absent from the graph`);
  const evidenceChainValid = cps.ok && chain.ok && missingHeads === 0;

  // 3) الهدف والنية والعقد والخطة
  let contractOk = false;
  try {
    if (t.contract) {
      parseContract(t.contract);
      contractOk = true;
    }
  } catch {
    contractOk = false;
  }
  const planConsistent = t.plan ? t.plan.strategyId === t.intent?.strategyId && t.plans.length === t.plan.version : t.state === "BLOCKED";
  const goalVerified = Boolean(t.intent) && contractOk && planConsistent;
  if (!goalVerified) problems.push("intent/contract/plan are not consistent");

  // 4) النتيجة: يُعاد حسابها من الحقائق والعقد ويجب أن تطابق المُبلَّغ؛ وكل حقيقة مطلوبة true لها خطوة مُتحقَّقة أو أصل مسبق
  let recomputed: string | null = null;
  if (t.contract && t.outcome) {
    recomputed = evaluateOutcome(t.contract, t.facts).status;
    if (recomputed !== t.outcome.status) problems.push(`outcome recomputed as ${recomputed} but reported ${t.outcome.status}`);
    for (const k of t.contract.required) {
      if (t.facts[k] === true && !(k in report.base_facts) && !t.steps.some((s) => s.status === "VERIFIED" && s.step.establishes.includes(k))) problems.push(`required fact "${k}" is true without a verified step`);
    }
  }
  const outcomeVerified = t.state === "COMPLETED" && t.outcome?.status === "COMPLETED" && recomputed === "COMPLETED";

  // 5) كل محاولة لها إيصال في الرسم، وعدد التنفيذات = إيصالات EXECUTED = النقل الخام (لكل عملية)
  const graphReceipts = receiptsFromGraph(report.graph);
  const receiptIds = new Set(graphReceipts.map((r) => r.actionId));
  const attempts = t.steps.flatMap((s) => s.attempts);
  const unreceipted = attempts.filter((a) => a.outcome !== "ERROR" && a.outcome !== "INTERRUPTED" && a.actionId !== null && !receiptIds.has(a.actionId));
  const receiptless = attempts.filter((a) => (a.outcome === "EXECUTED" || (a.outcome === "DENIED" && a.deniedAt !== "APPROVAL")) && a.actionId === null);
  if (unreceipted.length || receiptless.length) problems.push(`${unreceipted.length + receiptless.length} attempt(s) without a gateway receipt`);
  const executedInGraph = graphReceipts.filter((r) => r.outcome === "EXECUTED").length;
  const processes = t.processes ?? [];
  const processExecuted = processes.reduce((n, p) => n + p.executed, 0);
  if (processes.length && processExecuted !== executedInGraph) problems.push(`processes executed ${processExecuted} != graph executed ${executedInGraph}`);
  if (!processes.length && report.gateway.executed !== executedInGraph) problems.push("gateway.executed disagrees with the graph");
  const transportKnown = processes.length ? processes.every((p) => p.transportCalls !== null) : report.gateway.transport_calls !== null;
  const transportMatches = processes.length ? processes.every((p) => p.transportCalls === p.executed) : report.gateway.transport_calls === report.gateway.executed;
  if (transportKnown && !transportMatches) problems.push("transport_calls != executed in at least one process");
  const executedAttempts = attempts.filter((a) => a.outcome === "EXECUTED").length;
  const allGated = unreceipted.length === 0 && receiptless.length === 0 && attempts.length > 0 && executedAttempts === executedInGraph && (transportKnown ? transportMatches : null);

  // 6) إعادة التخطيط: مورست ونجحت (الخطوة الفاشلة تحققت لاحقًا بمرشح آخر)
  const recovered = t.steps.filter((s) => s.status === "VERIFIED" && s.attempts.some((a) => a.verdict !== "VERIFIED") && s.attempts.at(-1)?.verdict === "VERIFIED");
  const replanVerified: boolean | null = t.replans === 0 ? null : t.plans.length === t.replans + 1 && recovered.length > 0;

  // 7) لا عملية مدفوعة
  const noPaid = graphReceipts.every((r) => r.cost === 0 && !(r.outcome === "EXECUTED" && r.maxCostUsd > 0)) && report.base_facts.paid_use === false;

  const gate: Gen2Gate = {
    agent_goal_verified: goalVerified,
    outcome_contract_verified: outcomeVerified,
    all_actions_gated: asFact(allGated),
    replan_verified: asFact(replanVerified),
    evidence_chain_valid: evidenceChainValid,
    no_paid_operation: noPaid,
    runtime: "NOT_VERIFIED",
  };
  const values = [gate.agent_goal_verified, gate.outcome_contract_verified, gate.all_actions_gated, gate.replan_verified, gate.evidence_chain_valid, gate.no_paid_operation];
  gate.runtime = values.every((v) => v === true) && problems.length === 0 ? "PASS" : values.includes(false) || problems.length > 0 ? "FAIL" : "NOT_VERIFIED";

  const gen3 = assessGen3(report, { graphReceipts, states, problems, evidenceChainValid, fromStore: options.fromStore });

  const summary = [
    `GEN2_GATE runtime=${gate.runtime} agent_goal_verified=${String(gate.agent_goal_verified)} outcome_contract_verified=${String(gate.outcome_contract_verified)} all_actions_gated=${String(gate.all_actions_gated)} replan_verified=${String(gate.replan_verified)} evidence_chain_valid=${String(gate.evidence_chain_valid)} no_paid_operation=${String(gate.no_paid_operation)} tests_pass=ci`,
    `GEN3_GATE runtime=${gen3.runtime} persistence_verified=${String(gen3.persistence_verified)} resume_verified=${String(gen3.resume_verified)} approval_flow_verified=${String(gen3.approval_flow_verified)} partial_verified=${String(gen3.partial_verified)} artifacts_verified=${String(gen3.artifacts_verified)} tests_pass=ci`,
    `GEN2_REPLAY checkpoints=${report.checkpoints.length} chain=${cps.ok ? "ok" : "BROKEN"} graph_entries=${report.graph.length} graph_chain=${chain.ok ? "ok" : "BROKEN"} heads_linked=${missingHeads === 0 ? "yes" : "no"} processes=${processes.map((p) => `${p.mode}:${p.fromState}>${p.toState ?? "?"}`).join(",") || "-"} states=${states.join(">")} final=${t.state} outcome=${t.outcome?.status ?? "-"} recomputed=${recomputed ?? "-"} replans=${t.replans} recovered_steps=[${recovered.map((s) => s.step.id).join(",")}] artifacts=${t.artifacts.length} approvals=${report.approvals.length} problems=${problems.length ? problems.join(" | ") : "none"}`,
  ];
  return { ok: gate.runtime === "PASS", gate, gen3, problems, states, checkpoints: report.checkpoints.length, graphEntries: report.graph.length, recomputedOutcome: recomputed, summary };
}

function assessGen3(report: AgentRunReport, x: { graphReceipts: GraphReceipt[]; states: TaskState[]; problems: string[]; evidenceChainValid: boolean; fromStore?: { artifacts: Artifact[] } }): Gen3Gate {
  const t = report.task;
  const hashes = new Set<string>([CHECKPOINT_GENESIS, ...report.graph.map((e) => e.hash)]);
  const problems = x.problems;

  // الاستمرارية: اللقطة المخزّنة تشير إلى آخر نقطة تفتيش وآخر رأس دليل (لا يُثبت إلا من المخزن نفسه)
  const consistent = t.checkpointHead === (report.checkpoints.at(-1)?.hash ?? null) && t.evidenceChainHead === (report.graph.at(-1)?.hash ?? CHECKPOINT_GENESIS);
  if (!consistent) problems.push("task snapshot heads do not match the stored checkpoint/evidence heads");
  const persistence: Fact = x.fromStore ? consistent && x.evidenceChainValid : "unknown";

  // الاستئناف: عملية ثانية من نقطة تفتيش، انقطاع/انتظار مُسجَّل صراحةً، والمهمة بلغت نهاية، وكل عملية نقلها = تنفيذها
  const processes = t.processes ?? [];
  const resumes = processes.filter((p) => p.mode === "resume");
  const interrupted = t.steps.some((s) => s.attempts.some((a) => a.outcome === "INTERRUPTED"));
  const waited = x.states.includes("WAITING_APPROVAL");
  const terminal = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED"].includes(t.state);
  const perProcessOk = processes.every((p) => p.transportCalls === null || p.transportCalls === p.executed);
  const resume: Fact = resumes.length === 0 ? "unknown" : (interrupted || waited) && terminal && perProcessOk && resumes.every((p) => p.fromState !== "CREATED");

  // الموافقات: كل موافقة مقبولة ⇒ إيصال مُنفَّذ بأساس grant وتجزئة اقتراح مطابقة؛ كل مرفوضة/منتهية ⇒ لا تنفيذ لذلك الاقتراح
  let approvalFlow: Fact | "tests" = "tests";
  if (report.approvals.length) {
    approvalFlow = true;
    for (const a of report.approvals) {
      const executed = x.graphReceipts.filter((r) => r.proposalHash === a.proposalHash && r.outcome === "EXECUTED");
      if (a.status === "approved") {
        if (!(executed.length === 1 && executed[0]!.basis === "grant")) approvalFlow = false;
      } else if (executed.length > 0) approvalFlow = false;
      if (a.status === "pending" && terminal) approvalFlow = false;
    }
    if (approvalFlow === false) problems.push("approval flow violated (approved without grant-based execution, or executed without approval)");
  }

  // الجزئي: الحالة النهائية تطابق حكم العقد، وCOMPLETED/PARTIAL من VERIFYING فقط (يُفحص في الإعادة)
  const o = t.outcome;
  const partialSemantics = !terminal
    ? null
    : t.state === "COMPLETED"
      ? o?.status === "COMPLETED" && o.unmet.length === 0 && o.unknown.length === 0
      : t.state === "PARTIAL"
        ? o?.status === "PARTIAL" && o.met.length > 0 && o.unmet.length > 0
        : o !== null && o.status !== "COMPLETED";
  if (partialSemantics === false) problems.push(`terminal state ${t.state} inconsistent with outcome ${o?.status}`);

  // المخرجات: من خطوات VERIFIED فقط، مربوطة بفعل مُنفَّذ ورأس دليل موجود، وتجزئتها تُعاد حسابيًا (من المخزن)
  let artifactsOk: Fact = true;
  for (const a of t.artifacts) {
    const step = t.steps.find((s) => s.step.id === a.stepId);
    const receipt = x.graphReceipts.find((r) => r.actionId === a.ref);
    if (!step || step.status !== "VERIFIED" || !receipt || receipt.outcome !== "EXECUTED" || !hashes.has(a.evidenceHead)) artifactsOk = false;
  }
  if (x.fromStore) {
    const stored = x.fromStore.artifacts;
    if (stored.length !== t.artifacts.length) artifactsOk = false;
    for (const a of stored) if (!verifyArtifact(a)) artifactsOk = false;
  } else if (t.artifacts.length && artifactsOk) artifactsOk = "unknown"; // بلا بيانات لا تُعاد التجزئة
  if (artifactsOk === false) problems.push("artifact linkage or hash verification failed");

  const gen3: Gen3Gate = { persistence_verified: persistence, resume_verified: resume, approval_flow_verified: approvalFlow, partial_verified: asFact(partialSemantics), artifacts_verified: artifactsOk, runtime: "NOT_VERIFIED" };
  const vals: Array<Fact | "tests"> = [gen3.persistence_verified, gen3.resume_verified, gen3.approval_flow_verified, gen3.partial_verified, gen3.artifacts_verified];
  gen3.runtime = vals.includes(false) ? "FAIL" : vals.every((v) => v === true || v === "tests") ? "PASS" : "NOT_VERIFIED";
  return gen3;
}

/** إعادة من المخزن نفسه: التقرير يُبنى مما استقر على القرص، لا مما رواه الوكيل. */
export function replayFromStore(store: TaskStore, taskId: string): { report: AgentRunReport; result: ReplayResult } {
  const task = store.loadTask(taskId);
  if (!task) throw new Error(`no task ${taskId} in the store`);
  const artifacts = store.artifacts(taskId);
  task.artifacts = artifacts;
  const graph = store.evidence(taskId);
  const receipts = receiptsFromGraph(graph);
  const executed = receipts.filter((r) => r.outcome === "EXECUTED").length;
  const transport = task.processes.every((p) => p.transportCalls !== null) ? task.processes.reduce((n, p) => n + (p.transportCalls ?? 0), 0) : null;
  const denied = { CAPABILITY: 0, POLICY: 0, AUTHORIZATION: 0, APPROVAL: 0, COST: 0, EXECUTION: 0 } as Record<string, number>;
  for (const r of receipts) if (r.deniedAt) denied[r.deniedAt] = (denied[r.deniedAt] ?? 0) + 1;
  const report: AgentRunReport = {
    generated_at: new Date().toISOString(),
    agent: task.agentId,
    task: serializeTask(task),
    checkpoints: store.checkpoints(taskId),
    receipts: receipts as unknown as Record<string, unknown>[],
    gateway: { submitted: receipts.length, executed, verified: 0, denied: denied as never, boundaryCalls: {}, evidenceHead: graph.at(-1)?.hash ?? CHECKPOINT_GENESIS, transport_calls: transport, ungated_calls: transport === null ? null : Math.max(0, transport - executed) },
    base_facts: Object.fromEntries(Object.entries(task.facts).filter(([k]) => ["paid_use", "ungated_action", "secret_absent", "secret_exposure"].includes(k))),
    graph,
    approvals: store.approvalsFor(taskId),
    audit: store.auditLog(taskId),
    lines: [],
  };
  return { report, result: replayRun(report, { fromStore: { artifacts } }) };
}

async function main(): Promise<void> {
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const file = arg("--in");
  const db = arg("--db");
  const taskId = arg("--task");
  let r: ReplayResult;
  if (db && taskId) {
    const { SqliteTaskStore } = await import("../task/sqlite-store.ts");
    const store = new SqliteTaskStore(db);
    try {
      r = replayFromStore(store, taskId).result;
    } finally {
      store.close();
    }
  } else if (file) {
    r = replayRun(JSON.parse(readFileSync(file, "utf8")) as AgentRunReport);
  } else throw new Error("--in <agent run json> or --db <sqlite> --task <id> is required");
  for (const line of r.summary) console.log(`::notice title=${line.split(" ")[0]}::${line.replace(/[^\x20-\x7E]/g, "?").slice(0, 900)}`);
  const gen3ok = r.gen3.runtime === "PASS";
  process.exit(r.ok && (db ? gen3ok : true) ? 0 : 1);
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.log(`::error title=GEN2_REPLAY::${err instanceof Error ? `${err.name}: ${err.message.replace(/[^\x20-\x7E]/g, "?").slice(0, 300)}` : "Error"}`);
    process.exit(1);
  });
}
