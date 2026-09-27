/**
 * Celia · adapters/aisa · **جسر الدليل** (Evidence Bridge) — حكم NEXA على مخرجات خط الأنابيب المحكوم.
 *
 * يقرأ JSON خط الأنابيب (`pipeline.ts --json`) بعد تشغيله في GitHub Actions، ولا يتصل بأي شبكة:
 *   1. يستورد رسم الدليل الذي أنتجته البوابة **أثناء** التنفيذ ويتحقق من سلسلة تجزئته (تلاعب ⇒ FAILED).
 *   2. يشتقّ حقائق (true/false/"unknown") من `facts.gate` و`facts.gateway` وسطور الدليل — لا يخترع حقيقة غائبة.
 *   3. يثبت البوابة القبلية: كل نداء شبكي مرّ بالبوابة (transport_calls == executed، ungated_calls == 0)
 *      وكل تنفيذ سبقته مراحل POLICY → AUTHORIZATION → APPROVAL في إيصاله.
 *   4. يرفع سلّم قدرة `aisa` بدليل الإيصال: CAN → AVAILABLE. لا يتجاوز AVAILABLE أبدًا هنا.
 *   5. يحكم بعقد النتيجة `contract.readonly.json` ⇒ COMPLETED / PARTIAL / BLOCKED / NOT_VERIFIED / FAILED،
 *      ويحسب الجزء الزمني من GEN1_GATE (tests_pass = CI).
 *
 * تقارير بلا `facts.gateway` (شكل GEN-0) تُقبل: حقائق البوابة تصبح "unknown" ⇒ NOT_VERIFIED، لا ادّعاء.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_STAGES,
  CapabilityRegistry,
  EvidenceGraph,
  evaluateOutcome,
  formatVerdict,
  parseContract,
  stageRank,
  type CapabilityState,
  type Entry,
  type Fact,
  type Facts,
  type OutcomeContract,
  type OutcomeVerdict,
} from "../../nexa/index.ts";

export type AdapterReport = { generated_at?: string; facts: Record<string, unknown>; lines: string[]; graph?: Entry[] };

export type ReceiptView = {
  actionId: string;
  operation: string;
  outcome: string;
  deniedAt: string | null;
  stage: string;
  ladder: string;
  registryState: string | null;
  policy: string | null;
  basis: string | null;
  reason: string | null;
  stages: string[];
};

export type BridgeResult = {
  facts: Facts;
  details: Record<string, string>;
  verdict: OutcomeVerdict;
  gen1: { runtime: "PASS" | "FAIL" | "NOT_VERIFIED"; parts: Record<string, string> };
  capability: { id: string; state: CapabilityState; evidence: string[] };
  receipts: ReceiptView[];
  graph: EvidenceGraph;
  runtimeChain: { present: boolean; ok: boolean; entries: number; head: string | null };
  summary: string[];
};

const SECRET_PATTERN = /sk-aisa-[A-Za-z0-9_-]{8,}/;
const MONETARY_PATH = /usd|balance|credit|wallet|spend|spent|cost|charge|amount|price/i;
const TASK_ID = "task:aisa-readonly-discovery";

const asRecord = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseAdapterReport(value: unknown): AdapterReport {
  const r = asRecord(value);
  if (!r || !Array.isArray(r.lines) || !r.lines.every((l) => typeof l === "string")) throw new Error("adapter report must have string[] lines");
  const graph = Array.isArray(r.graph) ? (r.graph as Entry[]) : undefined;
  return { generated_at: typeof r.generated_at === "string" ? r.generated_at : undefined, facts: asRecord(r.facts) ?? {}, lines: r.lines as string[], graph };
}

/** قيم البوابة: من `facts.gate` إن وُجد، وإلا من آخر سطر `GATE:`. */
export function gateValues(report: AdapterReport): Record<string, string> {
  const fromFacts = asRecord(report.facts.gate);
  if (fromFacts) return Object.fromEntries(Object.entries(fromFacts).map(([k, v]) => [k, String(v)]));
  const line = [...report.lines].reverse().find((l) => l.startsWith("GATE: "));
  if (!line) return {};
  const out: Record<string, string> = {};
  for (const seg of line.slice("GATE: ".length).split(/\s+(?=AISA_[A-Z_]+=)/)) {
    const i = seg.indexOf("=");
    if (i > 0) out[seg.slice(0, i)] = seg.slice(i + 1).trim();
  }
  return out;
}

const lastLineOf = (report: AdapterReport, section: string): string | null => [...report.lines].reverse().find((l) => l.startsWith(`${section}: `)) ?? null;

function verifiedFact(v: string | undefined): Fact {
  if (v === undefined || v === "NOT_VERIFIED" || v === "NOT_TESTED") return "unknown";
  if (v === "VERIFIED") return true;
  if (v === "REJECTED" || /^HTTP_\d+/.test(v) || /^GATEWAY_/.test(v)) return false;
  return "unknown";
}

export function receiptsOf(report: AdapterReport): ReceiptView[] {
  const gw = asRecord(report.facts.gateway);
  const list = Array.isArray(gw?.receipts) ? gw!.receipts : [];
  return list
    .map(asRecord)
    .filter((r): r is Record<string, unknown> => r !== null && typeof r.operation === "string")
    .map((r) => ({
      actionId: String(r.actionId ?? ""),
      operation: String(r.operation),
      outcome: String(r.outcome ?? ""),
      deniedAt: r.deniedAt === null || r.deniedAt === undefined ? null : String(r.deniedAt),
      stage: String(r.stage ?? ""),
      ladder: String(r.ladder ?? ""),
      registryState: r.registryState === null || r.registryState === undefined ? null : String(r.registryState),
      policy: r.policy === null || r.policy === undefined ? null : String(r.policy),
      basis: r.basis === null || r.basis === undefined ? null : String(r.basis),
      reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
      stages: Array.isArray(r.stages) ? r.stages.map(String) : [],
    }));
}

/** إيصال مُنفَّذ سليم: مراحله بالترتيب الصارم، وPOLICY وAUTHORIZATION وAPPROVAL كلها قبل EXECUTION. */
export function receiptGatedBeforeExecution(r: ReceiptView): boolean {
  const idx = (s: string): number => (ACTION_STAGES as readonly string[]).indexOf(s);
  const ranks = r.stages.map(idx);
  if (ranks.some((x) => x < 0)) return false;
  for (let i = 1; i < ranks.length; i++) if (ranks[i]! < ranks[i - 1]!) return false;
  const first = (s: string): number => r.stages.indexOf(s);
  const exec = first("EXECUTION");
  if (exec < 0) return false;
  return ["POLICY", "AUTHORIZATION", "APPROVAL"].every((s) => first(s) >= 0 && first(s) < exec) && stageRank(r.stage as (typeof ACTION_STAGES)[number]) >= stageRank("OBSERVATION");
}

/** اشتقاق الحقائق — كل حقيقة لها مصدر واحد محدد؛ غياب المصدر ⇒ "unknown". */
export function deriveFacts(report: AdapterReport, runtimeChain: { present: boolean; ok: boolean }): { facts: Facts; details: Record<string, string> } {
  const gate = gateValues(report);
  const facts: Facts = {};
  const details: Record<string, string> = {};

  facts.secret_absent = gate.AISA_SECRET_PRESENT === "ABSENT" ? true : gate.AISA_SECRET_PRESENT === "VERIFIED" ? false : "unknown";
  facts.mcp_auth_verified = verifiedFact(gate.AISA_MCP_AUTH);
  facts.discovery_verified = verifiedFact(gate.AISA_DISCOVERY);
  facts.get_details_verified = verifiedFact(gate.AISA_GET_DETAILS);
  details.anonymous_search = gate.AISA_SEARCH_ANONYMOUS ?? "n/a";
  details.price_cap = gate.AISA_PRICE_CAP ?? "n/a";
  details.execution_authority = gate.AISA_EXECUTION_AUTHORITY ?? "n/a";

  // USE: paid_use_calls=N free_use_calls=[a,b] — مع إيصالات البوابة كمصدر ثانٍ
  const use = lastLineOf(report, "USE");
  const paid = use?.match(/paid_use_calls=(\d+)/);
  const free = use?.match(/free_use_calls=\[([^\]]*)\]/);
  const receipts = receiptsOf(report);
  const paidReceipts = receipts.filter((r) => r.operation.startsWith("use:") && r.operation !== "use:account" && r.outcome === "EXECUTED");
  if ((gate.AISA_PAID_USE !== undefined && gate.AISA_PAID_USE !== "NOT_EXECUTED") || paidReceipts.length > 0) facts.paid_use = true;
  else if (paid) facts.paid_use = Number(paid[1]) > 0;
  else facts.paid_use = "unknown";
  if (free) {
    const calls = free[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    facts.use_restricted_to_account = calls.every((c) => c === "account");
    details.free_use_calls = String(calls.length);
  } else facts.use_restricted_to_account = "unknown";

  // ACCOUNT: فرق محاسبي — المسارات النقدية فقط تُعدّ «رسمًا»؛ عدّادات النداءات لا.
  const delta = asRecord(report.facts.account_delta);
  const changed = Array.isArray(delta?.changed) ? (delta!.changed as Array<{ path?: unknown; delta?: unknown }>) : null;
  const account = lastLineOf(report, "ACCOUNT");
  if (changed) {
    const monetary = changed.filter((c) => typeof c.path === "string" && MONETARY_PATH.test(c.path));
    facts.zero_charge_delta = monetary.length === 0;
    details.account_changed_paths = String(changed.length);
    details.account_monetary_changed = String(monetary.length);
  } else if (account && /billing_related_changed=0\b/.test(account)) facts.zero_charge_delta = true;
  else facts.zero_charge_delta = "unknown";

  // GATEWAY (GEN-1): البوابة القبلية — عدّادات + ترتيب المراحل في كل إيصال مُنفَّذ
  const gw = asRecord(report.facts.gateway);
  if (gw) {
    const executed = Number(gw.executed);
    const transport = Number(gw.transport_calls);
    const boundary = Number(gw.boundary_calls);
    const ungated = Number(gw.ungated_calls);
    const executedReceipts = receipts.filter((r) => r.outcome === "EXECUTED");
    const ordered = executedReceipts.every(receiptGatedBeforeExecution);
    const consistent = Number.isFinite(executed) && executed === transport && executed === boundary && ungated === 0 && executedReceipts.length === executed;
    facts.pre_execution_gate_verified = consistent && ordered && executed > 0;
    details.gateway = `submitted=${String(gw.submitted)} executed=${executed} transport_calls=${transport} ungated_calls=${ungated} ordered_receipts=${ordered ? "yes" : "no"}`;
    const denied = asRecord(gw.denied);
    details.gateway_denied = denied ? Object.entries(denied).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}:${String(n)}`).join(",") || "0" : "n/a";
  } else facts.pre_execution_gate_verified = "unknown";

  // رسم الدليل الزمني: سلسلة سليمة = false للتلاعب؛ غائب = مجهول
  facts.runtime_evidence_tampered = runtimeChain.present ? !runtimeChain.ok : "unknown";

  // SECRET: أي سطر أو حقيقة تحمل مفتاحًا حقيقيًا ⇒ تسريب (المحوّل ينقّح؛ الجسر يتأكد).
  const corpus = report.lines.join("\n") + "\n" + JSON.stringify(report.facts) + "\n" + JSON.stringify(report.graph ?? []);
  facts.secret_exposure = SECRET_PATTERN.test(corpus.replace(/sk-aisa-\*{2,}/g, ""));

  return { facts, details };
}

function importRuntimeGraph(report: AdapterReport): { graph: EvidenceGraph; chain: BridgeResult["runtimeChain"] } {
  if (!report.graph || report.graph.length === 0) {
    const graph = new EvidenceGraph();
    return { graph, chain: { present: false, ok: false, entries: 0, head: null } };
  }
  const check = EvidenceGraph.verifyEntries(report.graph);
  if (!check.ok) {
    return { graph: new EvidenceGraph(), chain: { present: true, ok: false, entries: report.graph.length, head: null } };
  }
  const { graph } = EvidenceGraph.fromEntries(report.graph);
  return { graph, chain: { present: true, ok: true, entries: report.graph.length, head: graph.stats().head } };
}

export function bridge(report: AdapterReport, contract: OutcomeContract, now: string = new Date().toISOString()): BridgeResult {
  const { graph, chain } = importRuntimeGraph(report);
  const { facts, details } = deriveFacts(report, chain);
  const verdict = evaluateOutcome(contract, facts);
  const receipts = receiptsOf(report);

  // الرسم: نكمل سلسلة الـruntime نفسها (أو نبدأ رسمًا جديدًا إن غابت/كُسرت — ويُذكر ذلك صراحةً)
  if (!graph.getNode(TASK_ID)) graph.task(TASK_ID, now, { goal: contract.goal, source: "celia/adapters/aisa/pipeline.ts --json", runtimeGraph: chain.present ? (chain.ok ? "imported" : "REJECTED: chain broken") : "absent", generated_at: report.generated_at ?? null });
  const sections = ["KEY", "ANON", "AUTH", "SEARCH", "DETAILS", "POLICY", "PROPOSAL", "GATEWAY_PROPOSALS", "ACCOUNT", "USE", "GATEWAY"];
  graph.action(TASK_ID, "action:adapter-evidence", now, { reason: "redacted evidence lines emitted by the governed pipeline", executor: "bridge (offline)", risk: "read" });
  for (const section of sections) {
    const line = lastLineOf(report, section);
    if (line) graph.evidence("action:adapter-evidence", `evidence:${section.toLowerCase()}`, now, { line });
  }
  const gate = gateValues(report);
  if (Object.keys(gate).length) graph.evidence("action:adapter-evidence", "evidence:gate", now, { gate });

  // سلّم القدرة: CAN → AVAILABLE بدليل إيصال المصادقة (أو سطر AUTH إن غابت الإيصالات) — لا أبعد.
  const registry = new CapabilityRegistry();
  registry.register({ id: "aisa", kind: "connector", provider: "aisa.one", risk: "read", costModel: "free", fixedCostUsd: 0, dataClearance: "INTERNAL", readOnly: true, version: "mcp-2026-07-28", trust: "declared", availability: "known" });
  if (facts.mcp_auth_verified === true) {
    const authReceipt = receipts.find((r) => r.operation === "list_categories" && r.outcome === "EXECUTED");
    registry.raise("aisa", "AVAILABLE", authReceipt ? authReceipt.actionId : "evidence:auth", now);
  }
  const status = registry.get("aisa");

  // GEN1_GATE (الجزء الزمني): real_execution_pre_gate_verified ∧ paid_use=0 ∧ secret_exposure=0 (tests_pass = CI)
  const parts: Record<string, string> = {
    pre_execution_gate: String(facts.pre_execution_gate_verified),
    paid_use: String(facts.paid_use),
    secret_exposure: String(facts.secret_exposure),
    runtime_evidence_tampered: String(facts.runtime_evidence_tampered),
    tests_pass: "ci",
  };
  const gen1Runtime: BridgeResult["gen1"]["runtime"] =
    facts.pre_execution_gate_verified === true && facts.paid_use === false && facts.secret_exposure === false && facts.runtime_evidence_tampered === false
      ? "PASS"
      : [facts.pre_execution_gate_verified, facts.paid_use, facts.secret_exposure, facts.runtime_evidence_tampered].includes("unknown")
        ? "NOT_VERIFIED"
        : "FAIL";

  graph.verification(TASK_ID, "verification:contract", now, { contract, facts, verdict, gen1: { runtime: gen1Runtime, parts } });

  const gated = receipts.filter((r) => r.operation.startsWith("use:") && r.operation !== "use:account");
  const summary = [
    `NEXA_OUTCOME=${verdict.status} met=${verdict.met.join(",") || "-"} unmet=${verdict.unmet.join(",") || "-"} unknown=${verdict.unknown.join(",") || "-"} violated=${verdict.violated.join(",") || "-"} blocked=${verdict.blocked.join(",") || "-"}`,
    `NEXA_GEN1_GATE runtime=${gen1Runtime} ${Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    `NEXA_GATEWAY ${details.gateway ?? "absent (GEN-0 report shape)"} denied=${details.gateway_denied ?? "n/a"}`,
    `NEXA_CAPABILITY aisa=${status.state} (ladder CAN/AVAILABLE/AUTHORIZED/EXECUTABLE/EXECUTED/VERIFIED; bridge never exceeds AVAILABLE) evidence=${status.evidence.map((e) => e.ref).join(",") || "-"}`,
    `NEXA_PROPOSALS ${gated.map((r) => `${r.operation.slice(4)}:${r.outcome}@${r.deniedAt ?? r.stage}(${r.policy ?? "-"})`).join(" ") || "-"} (candidates submitted to the gateway; denied before the provider)`,
    `NEXA_EVIDENCE runtime_chain=${chain.present ? (chain.ok ? `ok(${chain.entries})` : "BROKEN") : "absent"} nodes=${graph.stats().nodes} edges=${graph.stats().edges} chain=${graph.verifyChain().ok ? "ok" : "BROKEN"} head=${graph.stats().head.slice(0, 12)}`,
    `NEXA_FACTS ${Object.entries(facts).map(([k, v]) => `${k}=${String(v)}`).join(" ")}`,
    `NEXA_MODE ${asRecord(report.facts.gateway) ? "pre-execution gating (GEN-1): every provider call passed nexa/gateway before the network; the bridge verified receipts, counters and the hash chain offline" : "post-hoc verification only (GEN-0 report shape: no gateway facts)"}`,
  ];
  return { facts, details, verdict, gen1: { runtime: gen1Runtime, parts }, capability: { id: "aisa", state: status.state, evidence: status.evidence.map((e) => e.ref) }, receipts, graph, runtimeChain: chain, summary };
}

export function loadContract(file: string): OutcomeContract {
  return parseContract(JSON.parse(readFileSync(file, "utf8")));
}

const DEFAULT_CONTRACT = fileURLToPath(new URL("./contract.readonly.json", import.meta.url));

function parseArgs(argv: string[]): { in: string; contract: string; graph: string | null; out: string | null } {
  const o = { in: "", contract: DEFAULT_CONTRACT, graph: null as string | null, out: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = argv[i + 1];
    if (a === "--in" && v) (o.in = v), i++;
    else if (a === "--contract" && v) (o.contract = v), i++;
    else if (a === "--graph" && v) (o.graph = v), i++;
    else if (a === "--out" && v) (o.out = v), i++;
    else throw new Error(`unknown/incomplete argument: ${a}`);
  }
  if (!o.in) throw new Error("--in <adapter json> is required");
  return o;
}

export function explainLines(result: BridgeResult): string[] {
  const ex = result.graph.explain(TASK_ID);
  return [
    `what: ${ex.what.map((n) => `${n.id}${typeof n.data.operation === "string" ? `[${n.data.operation}:${String(n.data.outcome)}]` : ""}`).join(", ") || "-"}`,
    `why: ${ex.why.join(" | ") || "-"}`,
    `proof: ${ex.proof.map((n) => n.id).join(", ") || "-"}`,
    `authorized by: ${ex.authorizedBy.map((n) => `${n.id}(${String(n.data.basis)})`).join(", ") || "-"}`,
    `changed: ${ex.changed.map((n) => n.id).join(", ") || "nothing (read-only)"}`,
    `verification: ${ex.verification.map((n) => `${n.id}=${n.data.verdict ? String((n.data.verdict as OutcomeVerdict).status) : String(n.data.verified)}`).join(", ") || "-"}`,
  ];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = parseAdapterReport(JSON.parse(readFileSync(args.in, "utf8")));
  const contract = loadContract(args.contract);
  const result = bridge(report, contract);
  for (const line of result.summary) {
    const ascii = line.replace(/[^\x20-\x7E]/g, "?").slice(0, 900);
    console.log(`::notice title=${ascii.split(" ")[0]}::${ascii}`);
  }
  console.log(formatVerdict(result.verdict));
  if (args.graph) writeFileSync(args.graph, result.graph.toJSONL());
  if (args.out) writeFileSync(args.out, [...result.summary, formatVerdict(result.verdict), "", "explain:", ...explainLines(result)].join("\n") + "\n");
  process.exit(result.verdict.status === "COMPLETED" ? 0 : 1);
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
    console.log(`::error title=NEXA_BRIDGE::${err instanceof Error ? `${err.name}: ${err.message.replace(/[^\x20-\x7E]/g, "?").slice(0, 300)}` : "Error"}`);
    process.exit(1);
  });
}
