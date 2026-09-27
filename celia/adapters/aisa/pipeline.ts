/**
 * Celia · adapters/aisa · **خط الأنابيب المحكوم** (GEN-1: NEXA decides BEFORE execution).
 *
 *   connect → authenticate → search → get_details → validate → price-cap → (submit candidate to gateway ⇒ DENIED) → evidence
 *
 * لا نداء شبكي واحد يصدر من هنا مباشرة: كل خطوة اقتراحٌ يُقدَّم إلى `ExecutionGateway`
 * (CAPABILITY → POLICY → AUTHORIZATION → APPROVAL → COST → EXECUTION → OBSERVATION → VERIFICATION → EVIDENCE)،
 * والمزوّد (`provider.ts`) هو الطريق الوحيد إلى الشبكة ولا يعرف إلا العمليات المجانية القرائية.
 * إثبات «لا نداء خارج البوابة»: عدّاد النقل الخام == تنفيذات البوابة (`ungated_calls=0`).
 *
 * المرشح المدفوع الذي يختاره المحوّل يُقدَّم فعلًا إلى البوابة — فتُرفض عند POLICY/APPROVAL قبل المزوّد،
 * والمزوّد نفسه يرفض `use:<id>` بنيويًا لو وصلته. الرفض دليل runtime، لا وعد.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AISA_MCP_ENDPOINT,
  AisaPolicyError,
  DEFAULT_POLICY,
  Evidence,
  READ_ONLY_TOOLS,
  autofillArguments,
  availabilityOf,
  availabilityRaw,
  decide,
  extractDetails,
  normalizePrice,
  numericDelta,
  sideEffectsOf,
  type Decision,
  type McpResponse,
  type Policy,
  type Proposal,
} from "./adapter.ts";
import { AISA_PROVIDER, candidateCapability, capabilityId, createAisaProvider, registerAisaCapabilities } from "./provider.ts";
import { CapabilityRegistry, CostGuard, ExecutionGateway, ResourceGuard, receiptSummary, type Entry, type EvidenceReceipt, type RiskLevel } from "../../nexa/index.ts";

export const AISA_TASK_ID = "task:aisa-readonly-discovery";
export const AISA_TASK_GOAL = "AIsa read-only discovery through the NEXA execution gateway: authenticate, discover, read details, propose - never execute paid use";
/** ميزانية طلبات ذاتية لكل تشغيل (fail-closed) — ليست حصة AIsa؛ حصص المنصات السحابية = PLANNED. */
export const AISA_REQUESTS_PER_RUN = 20;

export type CliOptions = {
  query: string;
  category: string | null;
  limit: number;
  maxPriceUsd: number;
  args: Record<string, unknown> | null;
  autofill: boolean;
  accountSnapshot: boolean;
  out: string | null;
  json: string | null;
};

const asRecord = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseCli(argv: string[]): CliOptions {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  let args: Record<string, unknown> | null = null;
  const rawArgs = get("--args");
  if (rawArgs) {
    args = asRecord(JSON.parse(rawArgs));
    if (!args) throw new AisaPolicyError("BAD_ARGS", "--args must be a JSON object");
  }
  return {
    query: get("--query") ?? "documentation page that teaches AI coding agents how to install and use AIsa API skills via the AIsa CLI",
    category: get("--category"),
    limit: Math.min(10, Math.max(1, Number(get("--limit") ?? 3))),
    maxPriceUsd: Math.max(0, Number(get("--max-price-usd") ?? 0)),
    args,
    autofill: argv.includes("--autofill"),
    accountSnapshot: argv.includes("--account-snapshot"),
    out: get("--out"),
    json: get("--json"),
  };
}

export type PipelineResult = { ok: boolean; evidence: Evidence; graph: Entry[]; receipts: readonly EvidenceReceipt[] };

export async function runPipeline(opts: CliOptions, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): Promise<PipelineResult> {
  const key = (env.AISA_API_KEY ?? "").trim();
  const ev = new Evidence([key]);
  const gate: Record<string, string> = {
    AISA_SECRET_PRESENT: key ? "VERIFIED" : "ABSENT",
    AISA_MCP_AUTH: "NOT_VERIFIED",
    AISA_SEARCH_ANONYMOUS: "NOT_TESTED",
    AISA_DISCOVERY: "NOT_VERIFIED",
    AISA_GET_DETAILS: "NOT_VERIFIED",
    AISA_SCHEMA_VALIDATION: "subset",
    AISA_PRICE_CAP: `policy_max_usd=${opts.maxPriceUsd}`,
    AISA_PAID_USE: "NOT_EXECUTED",
    AISA_EXECUTION_AUTHORITY: "NEXA_GATEWAY_GEN1 (pre-execution; free read-only operations only; paid use disabled at provider)",
    AISA_RUNTIME_INTEGRATION: "NOT_PRESENT (adapter is standalone; not imported by app/ or lib/)",
  };

  // ---- NEXA: registry · cost guard · resource guard · gateway · provider -------------------------------
  const { boundary, counter } = createAisaProvider({ apiKey: key || null, fetchImpl });
  const registry = new CapabilityRegistry();
  registerAisaCapabilities(registry);
  const costGuard = new CostGuard({ perTaskUsd: opts.maxPriceUsd, perAgentUsd: opts.maxPriceUsd, totalUsd: opts.maxPriceUsd });
  const resources = new ResourceGuard({ "aisa.requests": { limit: AISA_REQUESTS_PER_RUN, unit: "count" }, "aisa.spend_usd": { limit: opts.maxPriceUsd, unit: "usd" } });
  const gateway = new ExecutionGateway({
    taskId: AISA_TASK_ID,
    goal: AISA_TASK_GOAL,
    registry,
    providers: [AISA_PROVIDER],
    boundaries: { [AISA_PROVIDER]: boundary },
    costGuard,
    grants: () => [],
    resourceGuard: resources,
    resources: { [AISA_PROVIDER]: { requests: "aisa.requests", spendUsd: "aisa.spend_usd" } },
  });
  const submit = (operation: string, args: Record<string, unknown>, extra: { maxCostUsd?: number; risk?: RiskLevel } = {}) =>
    gateway.submit({ intentId: "aisa-readonly-discovery", agentId: "adapter", capability: capabilityId(operation), operation, arguments: args, risk: extra.risk ?? "read", dataClass: "PUBLIC", maxCostUsd: extra.maxCostUsd ?? 0, proposedBy: "adapter" });
  const mcp = (r: EvidenceReceipt): McpResponse => (r.observation?.result as McpResponse | undefined) ?? { status: 0, networkError: r.reason ?? "gateway-denied", isError: true, errorCode: r.deniedAt ?? "denied", payload: null };
  const useCalls: string[] = [];
  const done = (ok: boolean): PipelineResult => {
    const stats = gateway.stats();
    const ungated = counter.calls - boundary.calls;
    ev.say(
      "GATEWAY",
      `submitted=${stats.submitted} executed=${stats.executed} verified=${stats.verified} denied=${Object.entries(stats.denied).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(",") || "0"} boundary_calls=${boundary.calls} transport_calls=${counter.calls} ungated_calls=${ungated} pre_execution_gate=${ungated === 0 && counter.calls === stats.executed ? "VERIFIED" : "BROKEN"} resources[${resources.summary()}] chain=${gateway.graph.verifyChain().ok ? "ok" : "BROKEN"}`,
    );
    ev.say("GATE", Object.entries(gate).map(([k, v]) => `${k}=${v}`).join(" "));
    ev.fact("gate", gate);
    ev.fact("gateway", { ...stats, transport_calls: counter.calls, boundary_calls: boundary.calls, ungated_calls: ungated, resources: resources.all(), receipts: gateway.receipts().map(receiptSummary) });
    return { ok, evidence: ev, graph: gateway.graph.entriesSnapshot(), receipts: gateway.receipts() };
  };

  ev.say("ADAPTER", `governed adapter (GEN-1); provider operations=[list_categories,search,get_details,use:account] raw allowlist=[${READ_ONLY_TOOLS.join(",")}] endpoint=${AISA_MCP_ENDPOINT}`, false);
  if (!key) ev.say("KEY", "AISA_API_KEY=absent (GitHub Actions secret; never via chat)");
  else ev.say("KEY", `AISA_API_KEY=present length=${key.length} prefix_ok=${key.startsWith("sk-aisa-") ? "yes" : "no"} (no fingerprint by default)`);

  // 0) لقطة حساب «قبل» (مجانية) — عبر البوابة
  let before: unknown = null;
  let beforeStatus = "n/a";
  if (key && opts.accountSnapshot) {
    const rc = await submit("use:account", {});
    const r = mcp(rc);
    if (rc.outcome === "EXECUTED") useCalls.push("account");
    before = r.payload;
    beforeStatus = `${r.status}${r.isError ? "!" : ""}`;
    ev.say("ACCOUNT", `snapshot before -> ${r.status} isError=${r.isError} gateway=${rc.outcome}${rc.deniedAt ? `@${rc.deniedAt}` : ""} (free, read-only; values never printed)`, false);
  }

  // 1) الوصول بلا مفتاح — سلوك الخادم الفعلي مقابل الكتالوج (عبر البوابة، بحجة anonymous)
  {
    const rc = await submit("search", { query: opts.query, limit: 1, anonymous: true });
    const r = mcp(rc);
    if (rc.outcome !== "EXECUTED") ev.say("ANON", `search (no key) -> gateway ${rc.outcome}@${rc.deniedAt}: ${rc.reason}`);
    else if (r.status === 0) ev.say("ANON", `search (no key) -> network-error ${r.networkError}`);
    else {
      gate.AISA_SEARCH_ANONYMOUS = r.status === 401 || r.status === 403 ? "CONTRADICTED_BY_RUNTIME" : r.status === 200 ? "AS_DOCUMENTED" : `HTTP_${r.status}`;
      ev.say("ANON", `search (no key) -> ${r.status} error_code=${r.errorCode} => ${gate.AISA_SEARCH_ANONYMOUS}`);
    }
  }
  if (!key) return done(false);

  // 2) connect + authenticate — list_categories (مجاني)
  {
    const rc = await submit("list_categories", {});
    const r = mcp(rc);
    const p = asRecord(r.payload);
    const fields = p ? Object.keys(p).slice(0, 12).join(",") : "n/a";
    const counts = p
      ? Object.entries(p)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
          .join(" ")
      : "";
    if (rc.outcome === "EXECUTED" && r.status === 200 && !r.isError) gate.AISA_MCP_AUTH = "VERIFIED";
    else if (r.status === 401 || r.status === 403) gate.AISA_MCP_AUTH = "REJECTED";
    else gate.AISA_MCP_AUTH = r.status === 0 ? (rc.outcome === "EXECUTED" ? "NETWORK_ERROR" : `GATEWAY_${rc.deniedAt}`) : `HTTP_${r.status}`;
    ev.say("AUTH", `list_categories (with key) -> ${r.status || `network-error ${r.networkError}`} isError=${r.isError} fields=[${fields}] ${counts} gateway=${rc.outcome} ladder=${rc.ladder}`.trim());
    ev.fact("list_categories", { status: r.status, fields, counts, gateway: rc.outcome, ladder: rc.ladder });
    // المصادقة ثبتت ⇒ القدرات القرائية الأربع تصبح AVAILABLE بدليل الإيصال (لا بادّعاء)
    if (gate.AISA_MCP_AUTH === "VERIFIED") for (const id of ["list_categories", "search", "get_details", "use:account"]) registry.raise(capabilityId(id), "AVAILABLE", rc.actionId, new Date().toISOString());
  }
  if (gate.AISA_MCP_AUTH !== "VERIFIED") return done(false);

  // 3) search (مجاني)
  const searchArgs: Record<string, unknown> = { query: opts.query, limit: opts.limit };
  if (opts.category) searchArgs.category = opts.category;
  const sc = await submit("search", searchArgs);
  const s = mcp(sc);
  const sp = asRecord(s.payload);
  const candidates = Array.isArray(sp?.candidates) ? (sp?.candidates as unknown[]).map(asRecord).filter((c): c is Record<string, unknown> => c !== null) : [];
  const ids = candidates.map((c) => String(c.operation_id ?? "?").slice(0, 80));
  gate.AISA_DISCOVERY = sc.outcome === "EXECUTED" && s.status === 200 && !s.isError ? "VERIFIED" : `HTTP_${s.status}`;
  ev.say("SEARCH", `-> ${s.status} isError=${s.isError} retrieval_mode=${String(sp?.retrieval_mode ?? "n/a")} plan=${sp?.plan ? "yes" : "no"} candidates=${candidates.length} operation_ids=[${ids.join(",")}] gateway=${sc.outcome} ladder=${sc.ladder}`);
  ev.fact("search", { status: s.status, query: opts.query, operation_ids: ids, gateway: sc.outcome });
  if (candidates.length === 0) return done(gate.AISA_DISCOVERY === "VERIFIED");

  // 4) get_details (مجاني) — العقد الكامل للمرشحين
  const dc = await submit("get_details", { operation_ids: ids });
  const d = mcp(dc);
  const detailList = extractDetails(d.payload, ids);
  const dp = asRecord(d.payload);
  const dFields = dp ? Object.keys(dp).slice(0, 12).join(",") : Array.isArray(d.payload) ? `array(${d.payload.length})` : "n/a";
  gate.AISA_GET_DETAILS = dc.outcome === "EXECUTED" && d.status === 200 && !d.isError && detailList.length > 0 ? "VERIFIED" : `HTTP_${d.status}_parsed=${detailList.length}`;
  ev.say("DETAILS", `-> ${d.status} isError=${d.isError} fields=[${dFields}] parsed=${detailList.length}/${ids.length} gateway=${dc.outcome}`, false);
  for (const det of detailList) {
    const price = normalizePrice(det.price);
    const req = det.arguments_schema?.required ?? [];
    const pitfalls = Array.isArray(det.known_pitfalls) ? det.known_pitfalls.length : det.known_pitfalls ? 1 : 0;
    ev.say(
      "DETAILS",
      `${det.operation_id}: read_only=${det.read_only ?? "undeclared"} side_effects=${sideEffectsOf(det.side_effects)} availability=${availabilityOf(det.availability)}(raw:${availabilityRaw(det.availability)}) price=${price.kind}${price.usd !== null ? `:${price.usd}usd` : ""} required=[${req.join(",")}] pitfalls=${pitfalls}`,
      false,
    );
  }

  // 5) proposals + 6) adapter policy — ثم 6b) تقديم كل مرشح إلى بوابة NEXA فعليًا (المتوقع: DENIED قبل المزوّد)
  const policy: Policy = { ...DEFAULT_POLICY, maxPriceUsd: opts.maxPriceUsd };
  const evaluated: Array<{ proposal: Proposal; decision: Decision; filled: string[] }> = [];
  for (const id of ids) {
    const det = detailList.find((x) => x.operation_id === id);
    if (!det) continue;
    let args = opts.args ?? {};
    let filled: string[] = [];
    if (!opts.args && opts.autofill) ({ args, filled } = autofillArguments(det.arguments_schema, opts.query));
    const proposal: Proposal = { operation_id: id, arguments: args, max_price_usd: opts.maxPriceUsd };
    evaluated.push({ proposal, decision: decide(det, proposal, policy), filled });
    if (!registry.has(capabilityId(`use:${id}`))) registry.register(candidateCapability(det));
  }
  const reasonCodes = (dec: Decision): string => [...new Set(dec.reasons.map((r) => r.split(":")[0]!.trim()))].join("+") || "-";
  if (evaluated.length > 0) {
    const chosen = evaluated.find((e) => e.decision.decision === "ADMIT_TO_AUTHORIZATION") ?? evaluated[0]!;
    const admitted = evaluated.filter((e) => e.decision.decision === "ADMIT_TO_AUTHORIZATION").length;
    gate.AISA_PRICE_CAP = `policy_max_usd=${opts.maxPriceUsd} admitted=${admitted}/${evaluated.length}`;
    ev.say("POLICY", `policy_max_usd=${opts.maxPriceUsd} ${evaluated.map((e) => `${e.proposal.operation_id}=${e.decision.decision === "DENY" ? `DENY(${reasonCodes(e.decision)})` : "ADMIT"}`).join(" ")}`, false);
    const c = chosen.decision.checks;
    ev.say("PROPOSAL", `chosen=${chosen.proposal.operation_id} decision=${chosen.decision.decision} arg_keys=[${Object.keys(chosen.proposal.arguments).join(",")}] autofilled=[${chosen.filled.join(",")}] max_price_usd=${chosen.proposal.max_price_usd} schema=${c.schema} price=${c.price.kind}${c.price.usd !== null ? `:${c.price.usd}usd` : ""} within_cap=${c.price_within_cap} read_only=${c.read_only ?? "undeclared"} side_effects=${c.side_effects} availability=${c.availability}(raw:${availabilityRaw(detailList.find((x) => x.operation_id === chosen.proposal.operation_id)?.availability)})${chosen.decision.reasons.length ? ` reasons=${chosen.decision.reasons.slice(0, 4).join(" | ")}` : ""} (proposal only; not executed)`);
    for (const e of evaluated) ev.say("POLICY", `${e.proposal.operation_id}: ${e.decision.decision}${e.decision.reasons.length ? ` reasons=${e.decision.reasons.slice(0, 6).join(" | ")}` : ""}`, false);
    ev.fact("proposals", evaluated.map((e) => ({ proposal: e.proposal, autofilled: e.filled, decision: e.decision })));

    // 6b) البوابة تحكم قبل المزوّد: كل مرشح يُقدَّم كاقتراح `use:<id>` بسقف السياسة — لا يصل إلى الشبكة
    const callsBefore = counter.calls;
    const gated: string[] = [];
    for (const e of evaluated) {
      const cap = registry.get(capabilityId(`use:${e.proposal.operation_id}`)).capability;
      const rc = await submit(`use:${e.proposal.operation_id}`, e.proposal.arguments, { maxCostUsd: opts.maxPriceUsd, risk: cap.risk });
      if (rc.outcome === "EXECUTED") gate.AISA_PAID_USE = `EXECUTED:${e.proposal.operation_id}`; // must never happen; provider refuses structurally
      gated.push(`${e.proposal.operation_id}=${rc.outcome}@${rc.deniedAt ?? rc.stage}(${rc.policy?.decision ?? "-"})`);
    }
    ev.say("GATEWAY_PROPOSALS", `${gated.join(" ")} transport_calls_before=${callsBefore} after=${counter.calls} (denied before provider; provider has no paid path)`, false);
  }

  // 7) لقطة حساب «بعد» — الفرق المحاسبي (أسماء مسارات + فروق فقط)
  if (opts.accountSnapshot) {
    const rc = await submit("use:account", {});
    const r = mcp(rc);
    if (rc.outcome === "EXECUTED") useCalls.push("account");
    const delta = numericDelta(before, r.payload);
    const billing = delta.changed.filter((c) => /usage|spend|spent|cost|charge|balance|wallet|credit|amount|total/i.test(c.path));
    ev.say("ACCOUNT", `snapshot before -> ${beforeStatus} after -> ${r.status} numeric_leaves=${delta.leaves} changed=${delta.changed.length} billing_related_changed=${billing.length}${billing.length ? ` [${billing.map((c) => `${c.path}:${c.delta > 0 ? "+" : ""}${c.delta}`).slice(0, 8).join(",")}]` : ""} gateway=${rc.outcome} (free, read-only; values never printed)`);
    ev.fact("account_delta", { leaves: delta.leaves, changed: delta.changed.slice(0, 20) });
  }

  ev.say("USE", `paid_use_calls=0 free_use_calls=[${useCalls.join(",")}] (use:account is the only use the provider can issue; paid use:<id> is disabled at the provider)`);
  return done(gate.AISA_MCP_AUTH === "VERIFIED" && gate.AISA_DISCOVERY === "VERIFIED");
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<number> {
  const opts = parseCli(argv);
  const { ok, evidence, graph } = await runPipeline(opts, env);
  if (opts.out) writeFileSync(opts.out, evidence.lines.join("\n") + "\n");
  if (opts.json) writeFileSync(opts.json, JSON.stringify({ generated_at: new Date().toISOString(), facts: evidence.facts, lines: evidence.lines, graph }, null, 2));
  return ok ? 0 : 1;
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`::error title=ADAPTER::${err instanceof Error ? `${err.name}${"code" in err ? `(${String((err as { code?: unknown }).code)})` : ""}` : "Error"}`);
      process.exit(1);
    });
}
