/**
 * Celia · adapters/aisa · **جسر الدليل** (Evidence Bridge) — الاستعمال الأول لـNEXA على دليل حقيقي.
 *
 * يقرأ مخرجات المحوّل (`adapter.ts --json`) بعد تشغيله في GitHub Actions، ولا يتصل بأي شبكة:
 *   1. يشتقّ حقائق (true/false/"unknown") من `facts.gate` وسطور الدليل — لا يخترع حقيقة غائبة.
 *   2. يبني رسم دليل (Evidence Graph) إلحاقيًا بسلسلة تجزئة: مهمة → أفعال المحوّل → أدلتها → تحقق.
 *   3. يرفع سلّم قدرة `aisa` بدليل: CAN → AVAILABLE (مصادقة MCP ثبتت). لا يتجاوز AVAILABLE أبدًا.
 *   4. يمرّر اقتراحات المحوّل الحقيقية على سياسة NEXA (فحص متقاطع) ويثبت أن لا شيء منها مفوَّض.
 *   5. يحكم بعقد النتيجة `contract.readonly.json` ⇒ COMPLETED / PARTIAL / BLOCKED / NOT_VERIFIED / FAILED.
 *
 * GEN-0: NEXA هنا يتحقق **بعد** التنفيذ (المحوّل نفّذ نداءات القراءة بمنفّذه الخاص). في GEN-1 يمرّ المحوّل
 * عبر حدّ التنفيذ قبل أي نداء. لا يُحمِّل هذا الملف `adapter.ts` — الدليل هو الوسيط الوحيد.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CapabilityRegistry,
  EvidenceGraph,
  authorize,
  evaluateOutcome,
  evaluatePolicy,
  formatVerdict,
  parseContract,
  proposalHash,
  type Capability,
  type CapabilityState,
  type Fact,
  type Facts,
  type OutcomeContract,
  type OutcomeVerdict,
  type Proposal,
} from "../../nexa/index.ts";

export type AdapterReport = { generated_at?: string; facts: Record<string, unknown>; lines: string[] };

export type BridgeResult = {
  facts: Facts;
  details: Record<string, string>;
  verdict: OutcomeVerdict;
  capability: { id: string; state: CapabilityState; evidence: string[] };
  policyCrossCheck: Array<{ operation: string; adapter: string; nexa: string; authorized: boolean; findings: string[] }>;
  graph: EvidenceGraph;
  summary: string[];
};

const SECRET_PATTERN = /sk-aisa-[A-Za-z0-9_-]{8,}/;
const MONETARY_PATH = /usd|balance|credit|wallet|spend|spent|cost|charge|amount|price/i;

const asRecord = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseAdapterReport(value: unknown): AdapterReport {
  const r = asRecord(value);
  if (!r || !Array.isArray(r.lines) || !r.lines.every((l) => typeof l === "string")) throw new Error("adapter report must have string[] lines");
  return { generated_at: typeof r.generated_at === "string" ? r.generated_at : undefined, facts: asRecord(r.facts) ?? {}, lines: r.lines as string[] };
}

/** قيم البوابة: من `facts.gate` إن وُجد، وإلا من آخر سطر `GATE:` (المحوّل يطبعه حتى عند الخروج المبكر). */
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

const lineOf = (report: AdapterReport, section: string): string | null => report.lines.find((l) => l.startsWith(`${section}: `)) ?? null;
const lastLineOf = (report: AdapterReport, section: string): string | null => [...report.lines].reverse().find((l) => l.startsWith(`${section}: `)) ?? null;

function verifiedFact(v: string | undefined): Fact {
  if (v === undefined || v === "NOT_VERIFIED" || v === "NOT_TESTED") return "unknown";
  if (v === "VERIFIED") return true;
  if (v === "REJECTED" || /^HTTP_\d+/.test(v)) return false;
  return "unknown"; // NETWORK_ERROR وغيرها: لا يثبت ولا ينفي
}

/** اشتقاق الحقائق — كل حقيقة لها مصدر واحد محدد؛ غياب المصدر ⇒ "unknown". */
export function deriveFacts(report: AdapterReport): { facts: Facts; details: Record<string, string> } {
  const gate = gateValues(report);
  const facts: Facts = {};
  const details: Record<string, string> = {};

  facts.secret_absent = gate.AISA_SECRET_PRESENT === "ABSENT" ? true : gate.AISA_SECRET_PRESENT === "VERIFIED" ? false : "unknown";
  facts.mcp_auth_verified = verifiedFact(gate.AISA_MCP_AUTH);
  facts.discovery_verified = verifiedFact(gate.AISA_DISCOVERY);
  facts.get_details_verified = verifiedFact(gate.AISA_GET_DETAILS);
  details.anonymous_search = gate.AISA_SEARCH_ANONYMOUS ?? "n/a";
  details.price_cap = gate.AISA_PRICE_CAP ?? "n/a";

  // USE: paid_use_calls=N free_use_calls=[a,b]
  const use = lastLineOf(report, "USE");
  const paid = use?.match(/paid_use_calls=(\d+)/);
  const free = use?.match(/free_use_calls=\[([^\]]*)\]/);
  if (gate.AISA_PAID_USE !== undefined && gate.AISA_PAID_USE !== "NOT_EXECUTED") facts.paid_use = true;
  else if (paid) facts.paid_use = Number(paid[1]) > 0;
  else facts.paid_use = "unknown";
  if (free) {
    const calls = free[1].split(",").map((s) => s.trim()).filter(Boolean);
    facts.use_restricted_to_account = calls.every((c) => c === "account");
    details.free_use_calls = String(calls.length);
  } else facts.use_restricted_to_account = "unknown";

  // ACCOUNT: فرق محاسبي قبل/بعد — المسارات النقدية فقط تُعدّ «رسمًا»؛ عدّادات النداءات لا.
  const delta = asRecord(report.facts.account_delta);
  const changed = Array.isArray(delta?.changed) ? (delta!.changed as Array<{ path?: unknown; delta?: unknown }>) : null;
  const account = lastLineOf(report, "ACCOUNT");
  if (changed) {
    const monetary = changed.filter((c) => typeof c.path === "string" && MONETARY_PATH.test(c.path));
    facts.zero_charge_delta = monetary.length === 0;
    details.account_changed_paths = String(changed.length);
    details.account_monetary_changed = String(monetary.length);
  } else if (account && /billing_related_changed=0\b/.test(account)) {
    facts.zero_charge_delta = true;
  } else facts.zero_charge_delta = "unknown";

  // SECRET: أي سطر أو حقيقة تحمل مفتاحًا حقيقيًا ⇒ تسريب (المحوّل ينقّح؛ الجسر يتأكد).
  const corpus = report.lines.join("\n") + "\n" + JSON.stringify(report.facts);
  facts.secret_exposure = SECRET_PATTERN.test(corpus.replace(/sk-aisa-\*{2,}/g, ""));

  return { facts, details };
}

type AdapterProposal = {
  proposal: { operation_id: string; arguments: Record<string, unknown>; max_price_usd: number };
  decision: { decision: string; reasons?: string[]; checks?: { price?: { kind?: string; usd?: number | null }; read_only?: boolean | null; side_effects?: string; availability?: string } };
};

function adapterProposals(report: AdapterReport): AdapterProposal[] {
  const list = report.facts.proposals;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is AdapterProposal => {
    const r = asRecord(p);
    const pr = asRecord(r?.proposal);
    return Boolean(pr && typeof pr.operation_id === "string" && asRecord(r?.decision));
  });
}

/** فحص متقاطع: كل اقتراح حقيقي من المحوّل يمرّ على سياسة NEXA — والنتيجة الملزمة: لا تفويض بلا منح. */
export function crossCheckProposals(report: AdapterReport, registry: CapabilityRegistry, now: string, capUsd: number): BridgeResult["policyCrossCheck"] {
  return adapterProposals(report).map((p, i) => {
    const checks = p.decision.checks ?? {};
    const kind = checks.price?.kind;
    const costModel: Capability["costModel"] = kind === "free" || kind === "fixed" || kind === "dynamic" ? kind : "unknown";
    const readOnly = checks.read_only === true && checks.side_effects === "none";
    const id = `aisa:${p.proposal.operation_id}`;
    if (!registry.has(id)) {
      registry.register({
        id,
        kind: "tool",
        provider: "aisa.one",
        risk: readOnly ? "read" : "write",
        costModel,
        fixedCostUsd: costModel === "fixed" && typeof checks.price?.usd === "number" ? checks.price.usd : null,
        dataClearance: "INTERNAL",
        readOnly,
        version: "get_details",
        trust: checks.availability === "ok" ? "declared" : "unknown",
      });
    }
    const capability = registry.get(id).capability;
    const proposal: Proposal = {
      id: `aisa-proposal-${i + 1}`,
      intentId: "aisa-readonly-discovery",
      capability: id,
      operation: p.proposal.operation_id,
      arguments: p.proposal.arguments ?? {},
      risk: readOnly ? "read" : "write",
      dataClass: "PUBLIC",
      maxCostUsd: Math.min(capUsd, Number(p.proposal.max_price_usd) || 0),
      proposedBy: "adapter",
      at: now,
    };
    const policy = evaluatePolicy({ capability, proposal, budgetRemainingUsd: capUsd, mode: "CLOUD", simulated: false });
    const auth = authorize(proposal, policy, [], now);
    return { operation: p.proposal.operation_id, adapter: p.decision.decision, nexa: policy.decision, authorized: auth.authorized, findings: policy.findings.map((f) => `${f.rule}: ${f.reason}`) };
  });
}

export function bridge(report: AdapterReport, contract: OutcomeContract, now: string = new Date().toISOString()): BridgeResult {
  const { facts, details } = deriveFacts(report);
  const verdict = evaluateOutcome(contract, facts);
  const capUsd = Number(details.price_cap.match(/policy_max_usd=([0-9.]+)/)?.[1] ?? 0);

  const registry = new CapabilityRegistry();
  registry.register({ id: "aisa", kind: "connector", provider: "aisa.one", risk: "read", costModel: "free", fixedCostUsd: 0, dataClearance: "INTERNAL", readOnly: true, version: "mcp-2026-07-28", trust: "declared" });

  const graph = new EvidenceGraph();
  const taskId = "task:aisa-readonly-discovery";
  graph.task(taskId, now, { goal: contract.goal, source: "celia/adapters/aisa/adapter.ts --json", generated_at: report.generated_at ?? null });

  // أقسام دليل المحوّل: ما كان نداءً شبكيًا يُقيَّم بسياسة NEXA بعد الفعل (post-hoc) ويُسجَّل أساس تفويضه.
  const sections: Array<{ section: string; reason: string; operation: string | null }> = [
    { section: "KEY", reason: "secret presence (never the value)", operation: null },
    { section: "ANON", reason: "documented free access probed without key", operation: "search" },
    { section: "AUTH", reason: "MCP list_categories with Bearer", operation: "list_categories" },
    { section: "SEARCH", reason: "operation discovery", operation: "search" },
    { section: "DETAILS", reason: "get_details schema/price/availability", operation: "get_details" },
    { section: "POLICY", reason: "adapter policy per candidate (local computation)", operation: null },
    { section: "PROPOSAL", reason: "chosen proposal (proposal only; never executed)", operation: null },
    { section: "ACCOUNT", reason: "free account snapshot before/after", operation: "use:account" },
    { section: "USE", reason: "use() accounting (local computation)", operation: null },
  ];
  const aisaCapability = registry.get("aisa").capability;
  const evidenceIds: Record<string, string> = {};
  for (const { section, reason, operation } of sections) {
    const line = lineOf(report, section);
    if (!line) continue;
    const key = section.toLowerCase();
    const actionId = `action:${key}`;
    graph.action(taskId, actionId, now, { section, reason, operation, executor: operation ? "adapter transport (GEN-0: executed before NEXA existed in the loop)" : "local computation", risk: "read" });
    const evId = `evidence:${key}`;
    graph.evidence(actionId, evId, now, { line, lines: report.lines.filter((l) => l.startsWith(`${section}: `)).length });
    evidenceIds[section] = evId;
    if (!operation) continue;
    const proposal: Proposal = { id: `aisa-${key}`, intentId: taskId, capability: "aisa", operation, arguments: {}, risk: "read", dataClass: "PUBLIC", maxCostUsd: 0, proposedBy: "adapter", at: now };
    const policy = evaluatePolicy({ capability: aisaCapability, proposal, budgetRemainingUsd: capUsd, mode: "CLOUD", simulated: false });
    const auth = authorize(proposal, policy, [], now);
    graph.authorization(actionId, `authorization:${key}`, now, { timing: "post-hoc", policy: policy.decision, basis: auth.basis, authorized: auth.authorized, note: auth.reasons[0] ?? null });
  }
  const gate = gateValues(report);
  if (Object.keys(gate).length) {
    graph.action(taskId, "action:gate", now, { section: "GATE", reason: "adapter gate vocabulary (AISA_*)", operation: null, executor: "local computation", risk: "read" });
    graph.evidence("action:gate", "evidence:gate", now, { gate });
  }

  // سلّم القدرة: CAN → AVAILABLE بدليل المصادقة فقط.
  if (facts.mcp_auth_verified === true && evidenceIds.AUTH) registry.raise("aisa", "AVAILABLE", evidenceIds.AUTH, now);
  const status = registry.get("aisa");

  const policyCrossCheck = crossCheckProposals(report, registry, now, capUsd);
  policyCrossCheck.forEach((c, i) => {
    const id = `action:proposal-${i + 1}`;
    graph.action(taskId, id, now, { section: "NEXA_POLICY", operation: c.operation, reason: `adapter=${c.adapter} nexa=${c.nexa}`, risk: "n/a", executed: false });
    graph.evidence(id, `evidence:proposal-${i + 1}`, now, { findings: c.findings, authorized: c.authorized, proposalHash: proposalHash({ capability: `aisa:${c.operation}`, operation: c.operation, arguments: {}, maxCostUsd: 0 }).slice(0, 12) });
  });

  graph.verification(taskId, "verification:contract", now, { contract, facts, verdict });

  const summary = [
    `NEXA_OUTCOME=${verdict.status} met=${verdict.met.join(",") || "-"} unmet=${verdict.unmet.join(",") || "-"} unknown=${verdict.unknown.join(",") || "-"} violated=${verdict.violated.join(",") || "-"} blocked=${verdict.blocked.join(",") || "-"}`,
    `NEXA_CAPABILITY aisa=${status.state} (ladder CAN/AVAILABLE/AUTHORIZED/EXECUTABLE/EXECUTED/VERIFIED; GEN-0 never exceeds AVAILABLE) evidence=${status.evidence.map((e) => e.ref).join(",") || "-"}`,
    `NEXA_POLICY proposals=${policyCrossCheck.length} ${policyCrossCheck.map((c) => `${c.operation}:adapter=${c.adapter}/nexa=${c.nexa}/authorized=${c.authorized ? "yes" : "no"}`).join(" ") || "-"}`,
    `NEXA_EVIDENCE nodes=${graph.stats().nodes} edges=${graph.stats().edges} chain=${graph.verifyChain().ok ? "ok" : "BROKEN"} head=${graph.stats().head.slice(0, 12)}`,
    `NEXA_FACTS ${Object.entries(facts).map(([k, v]) => `${k}=${String(v)}`).join(" ")}`,
    `NEXA_MODE post-hoc verification (GEN-0): adapter executed read-only calls itself; NEXA judged the evidence. Pre-execution gating through the boundary = GEN-1`,
  ];
  return { facts, details, verdict, capability: { id: "aisa", state: status.state, evidence: status.evidence.map((e) => e.ref) }, policyCrossCheck, graph, summary };
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

export function explainLines(result: BridgeResult): string[] {
  const ex = result.graph.explain("task:aisa-readonly-discovery");
  return [
    `what: ${ex.what.map((n) => n.id).join(", ") || "-"}`,
    `why: ${ex.why.join(" | ") || "-"}`,
    `proof: ${ex.proof.map((n) => n.id).join(", ") || "-"}`,
    `authorized by: ${ex.authorizedBy.map((n) => `${n.id}(${String(n.data.basis)})`).join(", ") || "-"}`,
    `changed: ${ex.changed.map((n) => n.id).join(", ") || "nothing (read-only)"}`,
    `verification: ${ex.verification.map((n) => `${n.id}=${String((n.data.verdict as OutcomeVerdict | undefined)?.status)}`).join(", ") || "-"}`,
  ];
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
