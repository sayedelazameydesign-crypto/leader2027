/**
 * Celia · core/agent · **الإعادة وبوابة GEN-2** — بلا شبكة، بلا سرّ، بلا ثقة بالتقرير:
 * تُعاد سلسلة نقاط التفتيش (تسلسل + تجزئة + شرعية الانتقالات)، وسلسلة رسم الدليل، ويُربط كل رأس دليل في النقاط بالرسم،
 * ويُعاد حساب النتيجة من الحقائق والعقد، ويُتحقق أن كل محاولة لها إيصال، وأن النقل الخام = تنفيذات البوابة.
 *
 *   GEN2_GATE = agent_goal_verified ∧ outcome_contract_verified ∧ all_actions_gated ∧ replan_verified ∧ evidence_chain_valid ∧ tests_pass
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceGraph, evaluateOutcome, parseContract, type Fact } from "../../nexa/index.ts";
import { CHECKPOINT_GENESIS, verifyCheckpoints, type Checkpoint, type TaskState } from "../task/index.ts";
import type { AgentRunReport } from "./agent.ts";

export type Gen2Gate = {
  agent_goal_verified: Fact;
  outcome_contract_verified: Fact;
  all_actions_gated: Fact;
  replan_verified: Fact;
  evidence_chain_valid: Fact;
  no_paid_operation: Fact;
  runtime: "PASS" | "FAIL" | "NOT_VERIFIED";
};

export type ReplayResult = {
  ok: boolean;
  gate: Gen2Gate;
  problems: string[];
  states: TaskState[];
  checkpoints: number;
  graphEntries: number;
  recomputedOutcome: string | null;
  summary: string[];
};

const asFact = (b: boolean | null): Fact => (b === null ? "unknown" : b);

export function replayRun(report: AgentRunReport): ReplayResult {
  const problems: string[] = [];
  const t = report.task;

  // 1) نقاط التفتيش: سلسلة + شرعية + الحالة النهائية = حالة المهمة، وCOMPLETED لا يسبقه إلا VERIFYING
  const cps = verifyCheckpoints(report.checkpoints as Checkpoint[]);
  if (!cps.ok) problems.push(`checkpoints: ${cps.reason}`);
  if (cps.ok && cps.final !== t.state) problems.push(`checkpoints end in ${cps.final} but task reports ${t.state}`);
  const states = cps.states;
  for (let i = 1; i < states.length; i++) if (states[i] === "COMPLETED" && states[i - 1] !== "VERIFYING") problems.push(`COMPLETED reached from ${states[i - 1]}`);
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

  // 5) كل محاولة لها إيصال، وعدد التنفيذات = عدد إيصالات EXECUTED = النقل الخام
  const attempts = t.steps.flatMap((s) => s.attempts);
  const receiptIds = new Set(report.receipts.map((r) => String(r.actionId)));
  const unreceipted = attempts.filter((a) => a.outcome !== "ERROR" && (!a.actionId || !receiptIds.has(a.actionId)));
  if (unreceipted.length) problems.push(`${unreceipted.length} attempt(s) without a gateway receipt`);
  const executedReceipts = report.receipts.filter((r) => r.outcome === "EXECUTED").length;
  if (executedReceipts !== report.gateway.executed) problems.push("gateway.executed disagrees with receipts");
  const transportKnown = report.gateway.transport_calls !== null;
  if (transportKnown && report.gateway.transport_calls !== report.gateway.executed) problems.push(`transport_calls=${report.gateway.transport_calls} != executed=${report.gateway.executed}`);
  const allGated = unreceipted.length === 0 && executedReceipts === report.gateway.executed && attempts.length > 0 && (transportKnown ? report.gateway.transport_calls === report.gateway.executed : null);

  // 6) إعادة التخطيط: مورست ونجحت (الخطوة الفاشلة تحققت لاحقًا بمرشح آخر)
  const recovered = t.steps.filter((s) => s.status === "VERIFIED" && s.attempts.some((a) => a.verdict !== "VERIFIED") && s.attempts.at(-1)?.verdict === "VERIFIED");
  const replanVerified: boolean | null = t.replans === 0 ? null : t.plans.length === t.replans + 1 && recovered.length > 0;

  // 7) لا عملية مدفوعة
  const noPaid = report.receipts.every((r) => Number(r.cost ?? 0) === 0 && (r.reservationId === null || r.reservationId === undefined)) && report.base_facts.paid_use === false;

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

  const summary = [
    `GEN2_GATE runtime=${gate.runtime} agent_goal_verified=${String(gate.agent_goal_verified)} outcome_contract_verified=${String(gate.outcome_contract_verified)} all_actions_gated=${String(gate.all_actions_gated)} replan_verified=${String(gate.replan_verified)} evidence_chain_valid=${String(gate.evidence_chain_valid)} no_paid_operation=${String(gate.no_paid_operation)} tests_pass=ci`,
    `GEN2_REPLAY checkpoints=${report.checkpoints.length} chain=${cps.ok ? "ok" : "BROKEN"} graph_entries=${report.graph.length} graph_chain=${chain.ok ? "ok" : "BROKEN"} heads_linked=${missingHeads === 0 ? "yes" : "no"} states=${states.join(">")} final=${t.state} outcome=${t.outcome?.status ?? "-"} recomputed=${recomputed ?? "-"} replans=${t.replans} recovered_steps=[${recovered.map((s) => s.step.id).join(",")}] problems=${problems.length ? problems.join(" | ") : "none"}`,
  ];
  return { ok: gate.runtime === "PASS", gate, problems, states, checkpoints: report.checkpoints.length, graphEntries: report.graph.length, recomputedOutcome: recomputed, summary };
}

function main(): void {
  const i = process.argv.indexOf("--in");
  const file = i >= 0 ? process.argv[i + 1] : undefined;
  if (!file) throw new Error("--in <agent run json> is required");
  const report = JSON.parse(readFileSync(file, "utf8")) as AgentRunReport;
  const r = replayRun(report);
  for (const line of r.summary) console.log(`::notice title=${line.split(" ")[0]}::${line.replace(/[^\x20-\x7E]/g, "?").slice(0, 900)}`);
  process.exit(r.ok ? 0 : 1);
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.log(`::error title=GEN2_REPLAY::${err instanceof Error ? `${err.name}: ${err.message.replace(/[^\x20-\x7E]/g, "?").slice(0, 300)}` : "Error"}`);
    process.exit(1);
  }
}
