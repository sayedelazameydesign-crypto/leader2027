/**
 * Celia · core/agent · **الفهم والنية** (GEN-2).
 *
 * UNDERSTAND في GEN-2 حتمي وصادق: الوكيل يفهم الأهداف التي يملك لها **قالب استراتيجية** (عقد نتيجة + خطوات)،
 * ويرفض ما لا يفهمه (BLOCKED) بدل التخمين. لا نموذج لغوي هنا — عندما يأتي (Model Mesh) سيطبّق الواجهة نفسها
 * `Understanding` ولن يتغيّر شيء بعدها: العقد → الخطة → البوابة.
 */
import { parseContract, type OutcomeContract } from "../../nexa/index.ts";
import type { Goal, Intent, PlanStep } from "../task/index.ts";
import type { AgentContext } from "./context.ts";

export type GoalTemplate = {
  id: string;
  describe: string;
  matches: (goal: Goal) => boolean;
  /** معاملات الاستراتيجية المستخرجة من الهدف (مثل الاستعلام). */
  params?: (goal: Goal) => Record<string, unknown>;
  contract: OutcomeContract;
  /** خطوات الاستراتيجية بالترتيب، بمرشحيها المرتبين. */
  strategy: (params: Record<string, unknown>, ctx: AgentContext) => PlanStep[];
};

export type UnderstandingResult =
  | { ok: true; intent: Intent; template: GoalTemplate }
  | { ok: false; code: "GOAL_NOT_UNDERSTOOD" | "GOAL_AMBIGUOUS" | "GOAL_CONSTRAINT" | "GOAL_CONTRACT"; reason: string };

export interface Understanding {
  understand(goal: Goal, ctx: AgentContext): Promise<UnderstandingResult>;
}

export class TemplateUnderstanding implements Understanding {
  private readonly templates: readonly GoalTemplate[];
  constructor(templates: readonly GoalTemplate[]) {
    this.templates = templates;
  }

  async understand(goal: Goal, ctx: AgentContext): Promise<UnderstandingResult> {
    if (!goal.text.trim()) return { ok: false, code: "GOAL_NOT_UNDERSTOOD", reason: "empty goal" };
    const matched = goal.templateId ? this.templates.filter((t) => t.id === goal.templateId) : this.templates.filter((t) => t.matches(goal));
    if (matched.length === 0) return { ok: false, code: "GOAL_NOT_UNDERSTOOD", reason: `no strategy understands "${goal.text.slice(0, 80)}" (known: ${this.templates.map((t) => t.id).join(",") || "none"})` };
    if (matched.length > 1) return { ok: false, code: "GOAL_AMBIGUOUS", reason: `goal matches ${matched.length} strategies (${matched.map((t) => t.id).join(",")}): choose one via templateId` };
    const template = matched[0]!;
    const cap = goal.constraints?.maxCostUsd;
    if (cap !== undefined && (!Number.isFinite(cap) || cap < 0 || cap > ctx.defaults.maxCostUsd)) {
      return { ok: false, code: "GOAL_CONSTRAINT", reason: `goal spend cap ${String(cap)} USD exceeds the agent cap ${ctx.defaults.maxCostUsd} USD (free-first: raising it is an explicit human decision, not a goal parameter)` };
    }
    let contract: OutcomeContract;
    try {
      contract = goal.contract ? parseContract(goal.contract) : parseContract(template.contract);
    } catch (e) {
      return { ok: false, code: "GOAL_CONTRACT", reason: e instanceof Error ? e.message : "bad contract" };
    }
    return {
      ok: true,
      template,
      intent: { id: `intent:${ctx.taskId}`, goal, contract, understoodBy: `template:${template.id}`, strategyId: template.id, params: template.params?.(goal) ?? {}, at: ctx.now() },
    };
  }
}
