/**
 * Celia · adapters/aisa · **تشغيل وكيل GEN-2 على AIsa** — التركيب فقط: مزوّد داخل حدّ التنفيذ، سجل قدرات، بوابة NEXA، قوالب أهداف، وكيل.
 *
 *   node celia/adapters/aisa/agent.ts --goal "discover aisa tools for web scraping" [--json out.json] [--checkpoints cp.jsonl] [--graph graph.jsonl]
 *
 * المفتاح من البيئة فقط (`AISA_API_KEY`). لا شيء هنا ينادي الشبكة مباشرة: الوكيل يقترح، البوابة تقرر، المزوّد ينفّذ خلف الحدّ.
 * غياب المفتاح لا يُخفى: الحقيقة `secret_absent=true` تدخل العقد كعائق ⇒ BLOCKED (لا FAILED ولا ادّعاء).
 */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, TemplateUnderstanding, createAgentContext, replayRun } from "../../core/agent/index.ts";
import { MemoryCheckpointStore } from "../../core/task/index.ts";
import { CapabilityRegistry, CostGuard, ExecutionGateway, ResourceGuard } from "../../nexa/index.ts";
import { AISA_PROVIDER, createAisaProvider, registerAisaCapabilities } from "./provider.ts";
import { AISA_GOAL_TEMPLATES, classifyAisaFailure, parseAisaResult } from "./goals.ts";

export const AISA_AGENT_REQUESTS_PER_RUN = 20;

export type AgentCliOptions = { goal: string; json: string | null; checkpoints: string | null; graph: string | null; limit: number };

export function parseAgentCli(argv: string[]): AgentCliOptions {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const goal = get("--goal");
  if (!goal) throw new Error("--goal <text> is required");
  return { goal, json: get("--json") ?? null, checkpoints: get("--checkpoints") ?? null, graph: get("--graph") ?? null, limit: Math.max(1, Math.min(5, Number(get("--limit") ?? 3))) };
}

export async function runAisaAgent(opts: AgentCliOptions, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  const apiKey = env.AISA_API_KEY ?? "";
  const { boundary, counter } = createAisaProvider({ apiKey, fetchImpl });
  const registry = new CapabilityRegistry();
  registerAisaCapabilities(registry);
  const taskId = "task:aisa-agent-discover";
  const costGuard = new CostGuard({ perTaskUsd: 0, perAgentUsd: 0, totalUsd: 0 });
  const resources = new ResourceGuard({ "aisa.requests": { limit: AISA_AGENT_REQUESTS_PER_RUN, unit: "count" }, "aisa.spend_usd": { limit: 0, unit: "usd" } });
  const gateway = new ExecutionGateway({
    taskId,
    goal: opts.goal,
    registry,
    providers: [AISA_PROVIDER],
    boundaries: { [AISA_PROVIDER]: boundary },
    costGuard,
    resourceGuard: resources,
    resources: { [AISA_PROVIDER]: { requests: "aisa.requests", spendUsd: "aisa.spend_usd" } },
  });
  const checkpoints = new MemoryCheckpointStore(opts.checkpoints ? (line) => appendFileSync(opts.checkpoints!, line + "\n") : undefined);
  const ctx = createAgentContext({
    agentId: "celia-agent",
    taskId,
    registry,
    gateway,
    checkpoints,
    facts: { secret_absent: apiKey.length === 0, secret_exposure: false },
    parseResult: parseAisaResult,
    classifyFailure: classifyAisaFailure,
    transportCalls: () => counter.calls,
  });
  const agent = new Agent({ ctx, understanding: new TemplateUnderstanding(AISA_GOAL_TEMPLATES) });
  const report = await agent.run({ text: opts.goal, params: { limit: opts.limit } });
  // تنقية دفاعية: لا مفتاح في أي سطر أو في التقرير (المزوّد لا يعيد المفتاح، لكن الفحص مستقل)
  const leak = apiKey.length >= 8 && JSON.stringify(report).includes(apiKey);
  report.base_facts.secret_exposure = leak;
  if (leak) report.task.facts.secret_exposure = true;
  return { report, replay: replayRun(report) };
}

async function main(): Promise<void> {
  const opts = parseAgentCli(process.argv.slice(2));
  const { report, replay } = await runAisaAgent(opts, process.env);
  for (const line of report.lines.filter((l) => /^(AGENT|PLAN|STATES|GATEWAY|OUTCOME):/.test(l) || /^STEP \w+: status=/.test(l)).slice(0, 10)) {
    console.log(`::notice title=${line.split(":")[0]}::${line.replace(/[^\x20-\x7E]/g, "?").slice(0, 900)}`);
  }
  for (const line of report.lines) console.log(line);
  for (const line of replay.summary) console.log(line);
  if (opts.json) writeFileSync(opts.json, JSON.stringify(report, null, 2));
  if (opts.graph) writeFileSync(opts.graph, report.graph.map((e) => JSON.stringify(e)).join("\n") + "\n");
  process.exit(report.task.state === "COMPLETED" ? 0 : 1);
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
