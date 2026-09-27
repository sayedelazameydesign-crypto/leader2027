/**
 * Celia · core/agent · **المخطِّط** (GEN-2): حتمي فوق استراتيجية القالب.
 *
 * ما يفعله: يحلّ المرشحين إلى قدرات **مسجلة** (Capability Resolver)، يُسقط ما يخالف قيود النية (قراءة‑فقط، سقف الإنفاق)،
 * يرتّب (الأعلى على السلّم أولًا، ثم الأرخص، ثم الأقل خطورة)، ويرفض الخطة إن بقيت خطوة بلا مرشح.
 * ما لا يفعله: لا يقرر السياسة (NEXA يقرر عند التقديم)، ولا ينادي مزوّدًا.
 */
import { riskRank } from "../../nexa/index.ts";
import type { Intent, Plan, PlanStep } from "../task/index.ts";
import { ladderRank, type AgentContext } from "./context.ts";
import { planHash } from "./plan.ts";

export type Rejected = Plan["rejected"][number];
export type PlanInput = { intent: Intent; strategy: PlanStep[]; ctx: AgentContext; previous?: Plan | null; reason: string; rejectedSeed?: Rejected[] };
export type PlanResult = { ok: true; plan: Plan } | { ok: false; reason: string; rejected: Rejected[] };

export interface Planner {
  plan(input: PlanInput): PlanResult;
}

export class StrategyPlanner implements Planner {
  plan({ intent, strategy, ctx, previous, reason, rejectedSeed }: PlanInput): PlanResult {
    const rejected: Rejected[] = [...(rejectedSeed ?? [])];
    const readOnlyGoal = intent.goal.constraints?.readOnly !== false;
    const steps: PlanStep[] = strategy.map((step) => {
      const admissible = step.candidates
        .map((c) => ({ ...c, maxCostUsd: c.maxCostUsd ?? ctx.defaults.maxCostUsd }))
        .filter((c) => {
          const drop = (why: string): false => {
            rejected.push({ stepId: step.id, capability: c.capability, operation: c.operation, reason: why });
            return false;
          };
          if (!ctx.registry.has(c.capability)) return drop("unknown capability: not in the registry");
          if (readOnlyGoal && c.risk !== "read") return drop(`risk ${c.risk} under a read-only goal`);
          if (!Number.isFinite(c.maxCostUsd) || c.maxCostUsd < 0) return drop("invalid spend cap");
          if (c.maxCostUsd > ctx.defaults.maxCostUsd) return drop(`spend cap ${c.maxCostUsd} USD exceeds agent cap ${ctx.defaults.maxCostUsd} USD`);
          return true;
        })
        .map((c, order) => ({ c, order, status: ctx.registry.get(c.capability) }))
        .sort((a, b) => ladderRank(b.status.state) - ladderRank(a.status.state) || (a.status.capability.fixedCostUsd ?? Number.POSITIVE_INFINITY) - (b.status.capability.fixedCostUsd ?? Number.POSITIVE_INFINITY) || riskRank(a.c.risk) - riskRank(b.c.risk) || a.order - b.order)
        .map((x) => x.c);
      return { ...step, candidates: admissible };
    });
    const empty = steps.find((s) => s.candidates.length === 0);
    if (empty) return { ok: false, reason: `step "${empty.id}" has no admissible capability (${rejected.filter((r) => r.stepId === empty.id).map((r) => `${r.capability}: ${r.reason}`).join("; ") || "no candidates"})`, rejected };
    const version = (previous?.version ?? 0) + 1;
    const base = { taskId: ctx.taskId, version, strategyId: intent.strategyId, steps, rejected, reason };
    return { ok: true, plan: { id: `plan:${ctx.taskId}:v${version}`, ...base, createdAt: ctx.now(), hash: planHash(base) } };
  }
}
