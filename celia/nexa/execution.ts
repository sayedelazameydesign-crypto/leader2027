/**
 * NEXA — حدّ التنفيذ (Execution Boundary) والمحاكاة (§16).
 *
 *   AI → proposes · NEXA → decides permission · Runtime → executes · Evidence → proves
 *
 * `runAction` هو الحدّ: لا يمرّ فعل إلى أي منفّذ إلا إذا كان مفوَّضًا (authorization.authorized)
 * وسياسته ليست DENY ولديه حجز تكلفة (إن لم يكن مجانيًا). المنفّذ الافتراضي يرفض كل شيء
 * (`DeniedExecutor`) — المنفّذات الحقيقية (ملفات/طرفية/متصفح/AISA use) خارج GEN-0 عمدًا.
 * `SimulationExecutor` يقيس الأثر ولا يفعل شيئًا؛ نطاق تدميري أو مرجع إنتاجي ⇒ BLOCKED.
 */
import { NexaError, type Proposal } from "./protocol.ts";
import type { PolicyDecision } from "./policy.ts";
import type { AuthorizationResult } from "./authorization.ts";

export type AuthorizedAction = {
  proposal: Proposal;
  policy: PolicyDecision;
  authorization: AuthorizationResult;
  /** معرّف حجز التكلفة — إلزامي إن كان للاقتراح سقف > 0. */
  reservationId: string | null;
};

export type Observation = {
  proposalId: string;
  executor: string;
  mode: "real" | "simulation";
  startedAt: string;
  endedAt: string;
  ok: boolean;
  summary: string;
  sideEffects: string[];
  costUsd: number;
  artifacts: string[];
  /** الناتج الخام للمستدعي (لا يدخل رسم الدليل — الدليل يحمل الملخص المنقّح فقط). */
  result?: unknown;
};

export interface ExecutionBoundary {
  readonly id: string;
  readonly mode: "real" | "simulation" | "denied";
  execute(action: AuthorizedAction, now: () => string): Promise<Observation>;
}

/** الافتراضي: لا شيء يُنفَّذ. وجود القدرة ≠ قابلية تنفيذها. */
export class DeniedExecutor implements ExecutionBoundary {
  readonly id = "denied";
  readonly mode = "denied" as const;
  async execute(action: AuthorizedAction): Promise<Observation> {
    throw new NexaError("EXECUTION_NOT_BOUND", `no executor is bound for capability "${action.proposal.capability}" (GEN-0: read-only foundation)`);
  }
}

export type ImpactReport = {
  affected: number;
  dependenciesImpacted: number;
  productionReferences: number;
  destructive: boolean;
  notes: string[];
};

export function simulationVerdict(report: ImpactReport): { allowed: boolean; reason: string } {
  if (report.destructive) return { allowed: false, reason: "destructive scope" };
  if (report.productionReferences > 0) return { allowed: false, reason: `${report.productionReferences} production reference(s) detected` };
  return { allowed: true, reason: `${report.affected} affected, ${report.dependenciesImpacted} dependencies impacted, no production references` };
}

/** محاكاة: تحسب الأثر عبر دالة يوفّرها المنفّذ الحقيقي لاحقًا — ولا تمسّ شيئًا. */
export class SimulationExecutor implements ExecutionBoundary {
  readonly id: string;
  readonly mode = "simulation" as const;
  private readonly assess: (p: Proposal) => ImpactReport | Promise<ImpactReport>;
  constructor(id: string, assess: (p: Proposal) => ImpactReport | Promise<ImpactReport>) {
    this.id = id;
    this.assess = assess;
  }
  async execute(action: AuthorizedAction, now: () => string): Promise<Observation> {
    const startedAt = now();
    const report = await this.assess(action.proposal);
    const verdict = simulationVerdict(report);
    return {
      proposalId: action.proposal.id,
      executor: this.id,
      mode: "simulation",
      startedAt,
      endedAt: now(),
      ok: verdict.allowed,
      summary: `SIMULATION: ${report.affected} affected, ${report.dependenciesImpacted} dependencies impacted, ${report.productionReferences} production reference(s) — ${verdict.allowed ? "ALLOWED" : `EXECUTION BLOCKED (${verdict.reason})`}`,
      sideEffects: [],
      costUsd: 0,
      artifacts: [],
    };
  }
}

/** ما يعيده مزوّد حقيقي من داخل الحدّ: حالة، ملخص منقّح، تكلفة ملاحَظة، آثار جانبية، والناتج الخام للمستدعي. */
export type ProviderResult = {
  ok: boolean;
  status: number | null;
  summary: string;
  costUsd: number;
  sideEffects: string[];
  artifacts?: string[];
  result?: unknown;
};

export type ProviderCall = (operation: string, args: Record<string, unknown>, ctx: { proposalId: string; capability: string }) => Promise<ProviderResult>;

/**
 * منفّذ مزوّد حقيقي (GEN-1): الطريق الوحيد من البوابة إلى الشبكة. لا يُستدعى إلا من `runAction` بعد اجتياز
 * كل البوابات؛ يعدّ نداءاته (`calls`) ليُقارَن العدد بعدّاد النقل الخام — فأي نداء خارج البوابة يظهر كفارق.
 */
export class ProviderExecution implements ExecutionBoundary {
  readonly id: string;
  readonly mode = "real" as const;
  private readonly call: ProviderCall;
  private count = 0;
  constructor(id: string, call: ProviderCall) {
    this.id = id;
    this.call = call;
  }
  get calls(): number {
    return this.count;
  }
  async execute(action: AuthorizedAction, now: () => string): Promise<Observation> {
    const startedAt = now();
    this.count++;
    const r = await this.call(action.proposal.operation, action.proposal.arguments, { proposalId: action.proposal.id, capability: action.proposal.capability });
    return {
      proposalId: action.proposal.id,
      executor: this.id,
      mode: "real",
      startedAt,
      endedAt: now(),
      ok: r.ok,
      summary: r.summary,
      sideEffects: r.sideEffects,
      costUsd: r.costUsd,
      artifacts: r.artifacts ?? [],
      result: r.result,
    };
  }
}

/** الحدّ نفسه: الفحوص التي لا يتجاوزها أي منفّذ. */
export function assertExecutable(action: AuthorizedAction): void {
  if (action.policy.decision === "DENY") throw new NexaError("POLICY_DENIED", "execution boundary: policy denied");
  if (!action.authorization.authorized) throw new NexaError("NOT_AUTHORIZED", "execution boundary: not authorized");
  if (action.proposal.risk !== "read" && action.authorization.basis !== "grant") {
    throw new NexaError("APPROVAL_REQUIRED", `execution boundary: ${action.proposal.risk} action without human grant`);
  }
  if (action.proposal.maxCostUsd > 0 && action.authorization.basis !== "grant") throw new NexaError("APPROVAL_REQUIRED", "execution boundary: paid action without human grant");
  if (action.proposal.maxCostUsd > 0 && !action.reservationId) throw new NexaError("NO_RESERVATION", "execution boundary: paid action without cost reservation");
}

export async function runAction(boundary: ExecutionBoundary, action: AuthorizedAction, now: () => string = () => new Date().toISOString()): Promise<Observation> {
  assertExecutable(action);
  const obs = await boundary.execute(action, now);
  if (obs.mode === "real" && action.proposal.risk === "read" && obs.sideEffects.length > 0) {
    throw new NexaError("SIDE_EFFECTS_ON_READ", `read action produced side effects: ${obs.sideEffects.join(", ")}`);
  }
  if (obs.costUsd > action.proposal.maxCostUsd + 1e-9) {
    throw new NexaError("COST_CAP_BREACH", `observed cost ${obs.costUsd} USD exceeds proposal cap ${action.proposal.maxCostUsd} USD`);
  }
  return obs;
}
