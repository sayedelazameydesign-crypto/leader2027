/**
 * Celia · adapters/aisa · **تشغيل وكيل Celia على AIsa** (GEN-2 + GEN-3) — التركيب فقط:
 * مزوّد داخل حدّ التنفيذ، سجل قدرات، بوابة NEXA، قوالب أهداف، مخزن مهام (SQLite أو ذاكرة)، خدمة موافقات، وكيل.
 *
 *   node celia/adapters/aisa/agent.ts run     --goal "discover aisa tools for <query>" [--db celia.sqlite] [--task <id>] [--json out.json] [--graph g.jsonl]
 *   node celia/adapters/aisa/agent.ts resume  --db celia.sqlite --task <id> [--json out.json]
 *   node celia/adapters/aisa/agent.ts approvals --db celia.sqlite
 *   node celia/adapters/aisa/agent.ts approve --db celia.sqlite --approval <id> --by <human name>
 *   node celia/adapters/aisa/agent.ts reject  --db celia.sqlite --approval <id> --by <human name> [--reason "..."]
 *
 * المفتاح من البيئة فقط (`AISA_API_KEY`). لا شيء هنا ينادي الشبكة مباشرة: الوكيل يقترح، البوابة تقرر، المزوّد ينفّذ خلف الحدّ.
 * غياب المفتاح لا يُخفى: `secret_absent=true` عائق في العقد ⇒ BLOCKED قبل أي تخطيط.
 * حقن عطل للاختبار الحقيقي: `CELIA_CRASH_AT=<STATE>:<n>` يقتل العملية (SIGKILL) بعد التزام الانتقال رقم n إلى تلك الحالة.
 * الخروج: 0 = COMPLETED · 3 = WAITING_APPROVAL (استأنف بعد قرار بشري) · 1 = غير ذلك.
 */
import { writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, TemplateUnderstanding, createAgentContext, loadTaskForResume, replayFromStore, replayRun, type AgentRunReport, type ReplayResult } from "../../core/agent/index.ts";
import { ApprovalService, MemoryTaskStore, type TaskStore } from "../../core/task/index.ts";
import { CapabilityRegistry, CostGuard, ExecutionGateway, ResourceGuard, type EvidenceGraph } from "../../nexa/index.ts";
import { AISA_PROVIDER, createAisaProvider, registerAisaCapabilities } from "./provider.ts";
import { AISA_GOAL_TEMPLATES, classifyAisaFailure, parseAisaResult } from "./goals.ts";

export const AISA_AGENT_REQUESTS_PER_RUN = 20;
export const AISA_AGENT_TASK_ID = "task:aisa-agent-discover";

export type AgentCliOptions = { command: "run" | "resume" | "approvals" | "approve" | "reject"; goal: string | null; taskId: string; db: string | null; json: string | null; graph: string | null; limit: number; approval: string | null; by: string | null; reason: string | null };

export function parseAgentCli(argv: string[]): AgentCliOptions {
  const command = (["run", "resume", "approvals", "approve", "reject"] as const).find((c) => c === argv[0]) ?? "run";
  const rest = argv[0] === command ? argv.slice(1) : argv;
  const get = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const goal = get("--goal") ?? null;
  if (command === "run" && !goal) throw new Error("--goal <text> is required");
  if ((command === "approve" || command === "reject") && (!get("--approval") || !get("--by"))) throw new Error(`${command} needs --approval <id> --by <human name>`);
  if (command !== "run" && !get("--db")) throw new Error(`${command} needs --db <sqlite file>`);
  return { command, goal, taskId: get("--task") ?? AISA_AGENT_TASK_ID, db: get("--db") ?? null, json: get("--json") ?? null, graph: get("--graph") ?? null, limit: Math.max(1, Math.min(5, Number(get("--limit") ?? 3))), approval: get("--approval") ?? null, by: get("--by") ?? null, reason: get("--reason") ?? null };
}

export async function openStore(db: string | null): Promise<TaskStore & { close?: () => void }> {
  if (!db) return new MemoryTaskStore();
  const { SqliteTaskStore } = await import("../../core/task/sqlite-store.ts");
  return new SqliteTaskStore(db);
}

/** حقن عطل: يقتل العملية بعد الانتقال رقم n إلى الحالة المطلوبة — بعد التزام نقطة التفتيش، كما يفعل الموت الحقيقي. */
export function crashInjector(spec: string | undefined, kill: () => void = () => process.kill(process.pid, "SIGKILL")): ((state: string) => void) | undefined {
  if (!spec) return undefined;
  const [state, n] = spec.split(":");
  const target = Math.max(1, Number(n ?? 1));
  let seen = 0;
  return (to: string) => {
    if (to === state && ++seen === target) {
      writeSync(1, `::notice title=CRASH_INJECTED::process killed after committing transition #${target} to ${state} (CELIA_CRASH_AT=${spec})\n`);
      kill();
    }
  };
}

export type AisaAgentRun = { report: AgentRunReport; replay: ReplayResult; store: TaskStore & { close?: () => void } };

export async function runAisaAgent(opts: AgentCliOptions, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch, store?: TaskStore & { close?: () => void }, kill?: () => void): Promise<AisaAgentRun> {
  const apiKey = env.AISA_API_KEY ?? "";
  const { boundary, counter } = createAisaProvider({ apiKey, fetchImpl });
  const registry = new CapabilityRegistry();
  registerAisaCapabilities(registry);
  const taskId = opts.taskId;
  const theStore = store ?? (await openStore(opts.db));
  const resume = opts.command === "resume";
  const load = resume ? loadTaskForResume(theStore, taskId) : null;
  const costGuard = new CostGuard({ perTaskUsd: 0, perAgentUsd: 0, totalUsd: 0 });
  const resources = new ResourceGuard({ "aisa.requests": { limit: AISA_AGENT_REQUESTS_PER_RUN, unit: "count" }, "aisa.spend_usd": { limit: 0, unit: "usd" } });
  const gateway = new ExecutionGateway({
    taskId,
    goal: opts.goal ?? load?.task.goal.text ?? "",
    registry,
    providers: [AISA_PROVIDER],
    boundaries: { [AISA_PROVIDER]: boundary },
    costGuard,
    grants: () => theStore.grants(taskId),
    onGrantConsumed: (g) => theStore.saveGrant(taskId, g),
    resourceGuard: resources,
    resources: { [AISA_PROVIDER]: { requests: "aisa.requests", spendUsd: "aisa.spend_usd" } },
    graph: load?.graph as EvidenceGraph | undefined,
    startSeq: load?.startSeq,
  });
  const crash = crashInjector(env.CELIA_CRASH_AT, kill);
  const ctx = createAgentContext({
    agentId: "celia-agent",
    taskId,
    registry,
    gateway,
    store: theStore,
    approvals: new ApprovalService(theStore),
    facts: { secret_absent: apiKey.length === 0, secret_exposure: false },
    parseResult: parseAisaResult,
    classifyFailure: classifyAisaFailure,
    transportCalls: () => counter.calls,
    onTransition: crash ? (_t, to) => crash(to) : undefined,
  });
  const agent = new Agent({ ctx, understanding: new TemplateUnderstanding(AISA_GOAL_TEMPLATES) });
  const report = resume ? await agent.resume(load!.task) : await agent.run({ text: opts.goal!, params: { limit: opts.limit } });
  // تنقية دفاعية: لا مفتاح في أي سطر أو في التقرير (المزوّد لا يعيد المفتاح، لكن الفحص مستقل)
  const leak = apiKey.length >= 8 && JSON.stringify(report).includes(apiKey);
  report.base_facts.secret_exposure = leak;
  if (leak) report.task.facts.secret_exposure = true;
  const replay = opts.db ? replayFromStore(theStore, taskId).result : replayRun(report);
  return { report, replay, store: theStore };
}

async function main(): Promise<void> {
  const opts = parseAgentCli(process.argv.slice(2));
  if (opts.command === "approvals" || opts.command === "approve" || opts.command === "reject") {
    const store = await openStore(opts.db);
    try {
      const svc = new ApprovalService(store);
      svc.expireDue(new Date().toISOString());
      if (opts.command === "approvals") {
        for (const a of store.pendingApprovals()) console.log(`PENDING ${a.id} task=${a.taskId} step=${a.stepId} ${a.capability}/${a.operation} cost_cap=${a.costCap} hash=${a.proposalHash.slice(0, 12)} expires=${a.expiresAt} reason="${a.reason}"`);
        return;
      }
      const now = new Date().toISOString();
      const out = opts.command === "approve" ? svc.approve(opts.approval!, { decidedBy: opts.by!, principal: "human", now }) : svc.reject(opts.approval!, { decidedBy: opts.by!, principal: "human", now, reason: opts.reason ?? undefined });
      console.log(`${opts.command.toUpperCase()} ${opts.approval} by=${opts.by} ${"grant" in out ? `grant=${out.grant.id} single_use=true scope=${out.grant.scope.operation}@${out.grant.scope.proposalHash?.slice(0, 12)} cap=${out.grant.maxCostUsd}` : `status=${out.status}`}`);
      console.log(`next: node celia/adapters/aisa/agent.ts resume --db ${opts.db} --task ${(("approval" in out ? out.approval : out) as { taskId: string }).taskId}`);
      return;
    } finally {
      store.close?.();
    }
  }
  const { report, replay, store } = await runAisaAgent(opts, process.env);
  try {
    for (const line of report.lines.filter((l) => /^(AGENT|PLAN|STATES|PROCESSES|GATEWAY|OUTCOME):/.test(l) || /^STEP \w+: status=/.test(l)).slice(0, 10)) {
      console.log(`::notice title=${line.split(":")[0]}::${line.replace(/[^\x20-\x7E]/g, "?").slice(0, 900)}`);
    }
    for (const line of report.lines) console.log(line);
    for (const line of replay.summary) console.log(line);
    if (opts.json) writeFileSync(opts.json, JSON.stringify(report, null, 2));
    if (opts.graph) writeFileSync(opts.graph, report.graph.map((e) => JSON.stringify(e)).join("\n") + "\n");
    if (report.task.state === "WAITING_APPROVAL") console.log(`waiting for a human decision: node celia/adapters/aisa/agent.ts approvals --db ${opts.db ?? "<db>"}`);
  } finally {
    store.close?.();
  }
  process.exit(report.task.state === "COMPLETED" ? 0 : report.task.state === "WAITING_APPROVAL" ? 3 : 1);
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
    console.log(`::error title=AISA_AGENT::${err instanceof Error ? `${err.name}: ${err.message.replace(/[^\x20-\x7E]/g, "?").slice(0, 300)}` : "Error"}`);
    process.exit(1);
  });
}
