/**
 * NEXA — بوابة التنفيذ (Execution Gateway) — GEN-1.
 *
 * المدخل الوحيد لأي فعل يلمس مزوّدًا. القرار **قبل** التنفيذ لا بعده:
 *
 *   PROPOSAL → CAPABILITY (resolver) → POLICY → AUTHORIZATION → APPROVAL (grants) → RESOURCES/COST (reservation)
 *   → EXECUTION (boundary) → OBSERVATION → VERIFICATION → EVIDENCE (receipt) → MEMORY
 *
 * القواعد الصلبة:
 *   no authorization → no execution · no approval → no risky execution · unknown cost → deny
 *   unknown capability → deny · unknown provider → deny · no bound boundary → deny · quota exhausted → deny
 *
 * كل طلب — مُنفَّذًا كان أو مرفوضًا — يترك إيصال دليل (EvidenceReceipt) وعقدًا في رسم الدليل بسلسلة التجزئة.
 * الرفض دليلٌ أيضًا.
 */
import {
  NexaError,
  advance,
  assertLadderConsistent,
  canonicalJson,
  ladderAtLeast,
  openAction,
  proposalHash,
  raiseLadder,
  sha256Hex,
  type ActionRecord,
  type ActionStage,
  type CapabilityState,
  type DataClass,
  type Proposal,
  type RiskLevel,
  type StageEntry,
} from "./protocol.ts";
import type { CapabilityRegistry } from "./capability.ts";
import { evaluatePolicy, type PolicyDecision, type PolicyRule, type PrivacyMode } from "./policy.ts";
import { authorize, consumeGrant, type AuthorizationResult, type Grant } from "./authorization.ts";
import type { CostGuard } from "./cost-guard.ts";
import { runAction, type ExecutionBoundary, type Observation } from "./execution.ts";
import { EvidenceGraph } from "./evidence.ts";
import type { ResourceGuard } from "./resource-guard.ts";

export type GatewayConfig = {
  taskId: string;
  goal: string;
  registry: CapabilityRegistry;
  /** قائمة المزوّدين المعروفين — أي مزوّد خارجها ⇒ DENY عند CAPABILITY. */
  providers: readonly string[];
  /** حدّ التنفيذ المربوط لكل مزوّد — مزوّد بلا حدّ ⇒ DENY عند CAPABILITY. */
  boundaries: Record<string, ExecutionBoundary>;
  costGuard: CostGuard;
  /** مصدر المنح البشرية (ApprovalGate). يُستدعى عند كل طلب ليعكس الاستهلاك. */
  grants?: () => Grant[];
  onGrantConsumed?: (grant: Grant) => void;
  rules?: readonly PolicyRule[];
  mode?: PrivacyMode;
  localProviders?: readonly string[];
  graph?: EvidenceGraph;
  resourceGuard?: ResourceGuard;
  /** ربط المزوّد بموارد الحارس: وحدة `requests` لكل تنفيذ، و`spendUsd` بالتكلفة الملاحَظة. */
  resources?: Record<string, { requests?: string; spendUsd?: string }>;
  now?: () => string;
};

export type GatewayRequest = {
  intentId: string;
  agentId: string;
  capability: string;
  operation: string;
  arguments: Record<string, unknown>;
  risk: RiskLevel;
  dataClass: DataClass;
  maxCostUsd: number;
  proposedBy: string;
  simulated?: boolean;
};

export type DenialPoint = "CAPABILITY" | "POLICY" | "AUTHORIZATION" | "APPROVAL" | "COST" | "EXECUTION";

export type EvidenceReceipt = {
  actionId: string;
  proposalHash: string;
  capability: string;
  /** حالة القدرة في السجل وقت الطلب (CAN/AVAILABLE/…) — مستقلة عن سلّم الفعل. */
  registryState: CapabilityState | null;
  operation: string;
  outcome: "EXECUTED" | "DENIED";
  verified: boolean;
  stage: ActionStage;
  ladder: CapabilityState;
  deniedAt: DenialPoint | null;
  reason: string | null;
  policy: PolicyDecision | null;
  authorization: AuthorizationResult | null;
  reservationId: string | null;
  observation: Observation | null;
  history: StageEntry[];
  evidenceHead: string;
};

export type GatewayStats = {
  submitted: number;
  executed: number;
  verified: number;
  denied: Record<DenialPoint, number>;
  boundaryCalls: Record<string, number>;
  evidenceHead: string;
};

type Partial_ = {
  registryState?: CapabilityState | null;
  outcome: "EXECUTED" | "DENIED";
  verified: boolean;
  deniedAt: DenialPoint | null;
  reason: string | null;
  policy: PolicyDecision | null;
  authorization: AuthorizationResult | null;
  reservationId: string | null;
  observation: Observation | null;
};

export class ExecutionGateway {
  readonly graph: EvidenceGraph;
  private readonly cfg: GatewayConfig;
  private readonly now: () => string;
  private readonly list: EvidenceReceipt[] = [];
  private seq = 0;

  constructor(cfg: GatewayConfig) {
    this.cfg = cfg;
    this.now = cfg.now ?? (() => new Date().toISOString());
    this.graph = cfg.graph ?? new EvidenceGraph();
    if (!this.graph.getNode(cfg.taskId)) this.graph.task(cfg.taskId, this.now(), { goal: cfg.goal, gateway: "nexa/gateway GEN-1" });
    for (const [provider, b] of Object.entries(cfg.boundaries)) {
      if (!cfg.providers.includes(provider)) throw new NexaError("BOUNDARY_FOR_UNKNOWN_PROVIDER", `boundary "${b.id}" bound to unlisted provider "${provider}"`);
    }
  }

  receipts(): readonly EvidenceReceipt[] {
    return this.list;
  }

  stats(): GatewayStats {
    const denied: Record<DenialPoint, number> = { CAPABILITY: 0, POLICY: 0, AUTHORIZATION: 0, APPROVAL: 0, COST: 0, EXECUTION: 0 };
    let executed = 0;
    let verified = 0;
    for (const r of this.list) {
      if (r.outcome === "EXECUTED") executed++;
      if (r.verified) verified++;
      if (r.deniedAt) denied[r.deniedAt]++;
    }
    const boundaryCalls: Record<string, number> = {};
    for (const [provider, b] of Object.entries(this.cfg.boundaries)) boundaryCalls[provider] = "calls" in b && typeof (b as { calls?: unknown }).calls === "number" ? (b as { calls: number }).calls : -1;
    return { submitted: this.list.length, executed, verified, denied, boundaryCalls, evidenceHead: this.graph.stats().head };
  }

  async submit(req: GatewayRequest): Promise<EvidenceReceipt> {
    const { registry, providers, boundaries, costGuard, taskId } = this.cfg;
    const at = this.now();
    const proposal: Proposal = {
      id: `act-${++this.seq}`,
      intentId: req.intentId,
      capability: req.capability,
      operation: req.operation,
      arguments: req.arguments,
      risk: req.risk,
      dataClass: req.dataClass,
      maxCostUsd: req.maxCostUsd,
      proposedBy: req.proposedBy,
      at,
    };
    let record = openAction(proposal, at);
    let registryState: CapabilityState | null = null;
    const deny = (point: DenialPoint, reason: string, extra: Partial<Partial_> = {}): EvidenceReceipt =>
      this.finish(record, { registryState, outcome: "DENIED", verified: false, deniedAt: point, reason, policy: null, authorization: null, reservationId: null, observation: null, ...extra });

    // ---- CAPABILITY (resolver) ------------------------------------------
    if (!registry.has(req.capability)) return deny("CAPABILITY", `unknown capability "${req.capability}"`);
    const status = registry.get(req.capability);
    registryState = status.state;
    const cap = status.capability;
    if (!providers.includes(cap.provider)) return deny("CAPABILITY", `unknown provider "${cap.provider}"`);
    const boundary = boundaries[cap.provider];
    if (!boundary) return deny("CAPABILITY", `no execution boundary bound for provider "${cap.provider}"`);
    record = advance(record, "CAPABILITY", this.now(), `provider=${cap.provider} boundary=${boundary.id} registry=${status.state}`);
    // سلّم **الفعل**: AVAILABLE = القدرة مُحلّلة إلى مزوّد معروف وحدّ مربوط في هذا الـruntime.
    // سلّم **القدرة** في السجل (registryState) يُرفع إلى AVAILABLE بدليل اتصال/مصادقة حقيقي فقط — ويُبلَّغ منفصلًا.
    record = raiseLadder(record, "AVAILABLE", `resolver:${cap.provider}/${boundary.id} registry=${status.state}${ladderAtLeast(status.state, "AVAILABLE") ? ` (${status.evidence.find((e) => e.state === "AVAILABLE")?.ref ?? "registry"})` : " (unverified)"}`, this.now());

    // ---- POLICY (+ resource guard) ---------------------------------------
    const remaining = costGuard.remaining(taskId, req.agentId).min;
    const base = evaluatePolicy(
      { capability: cap, proposal, budgetRemainingUsd: remaining, mode: this.cfg.mode ?? "CLOUD", simulated: Boolean(req.simulated), localProviders: this.cfg.localProviders },
      this.cfg.rules,
    );
    const findings = [...base.findings];
    const paid = proposal.maxCostUsd > 0 || cap.costModel !== "free";
    const requestsResource = this.cfg.resources?.[cap.provider]?.requests;
    if (this.cfg.resourceGuard && requestsResource) {
      const a = this.cfg.resourceGuard.admit(requestsResource, 1, { risk: proposal.risk, paid });
      findings.push({ rule: "resources", severity: a.ok ? "info" : "deny", reason: a.reason });
    }
    const policy: PolicyDecision = {
      decision: findings.some((f) => f.severity === "deny") ? "DENY" : findings.some((f) => f.severity === "require_approval") ? "REQUIRE_APPROVAL" : "ADMIT",
      findings,
    };
    record = advance(record, "POLICY", this.now(), `${policy.decision} findings=${findings.length}`);
    if (policy.decision === "DENY") {
      return deny("POLICY", findings.filter((f) => f.severity === "deny").map((f) => `${f.rule}: ${f.reason}`).join(" | "), { policy });
    }

    // ---- AUTHORIZATION + APPROVAL ---------------------------------------
    const grants = this.cfg.grants?.() ?? [];
    const auth = authorize(proposal, policy, grants, this.now());
    record = advance(record, "AUTHORIZATION", this.now(), auth.authorized ? `basis=${auth.basis}` : "not authorized");
    if (!auth.authorized) return deny(policy.decision === "REQUIRE_APPROVAL" ? "APPROVAL" : "AUTHORIZATION", auth.reasons[0] ?? "not authorized", { policy, authorization: auth });
    record = advance(record, "APPROVAL", this.now(), auth.stamp ? `grant=${auth.stamp.grantId} by=${auth.stamp.approvedBy}(${auth.stamp.role})` : "not required: read action admitted by policy");
    record = raiseLadder(record, "AUTHORIZED", auth.stamp ? `grant:${auth.stamp.grantId}` : "policy:ADMIT", this.now());

    // ---- COST (reservation before execution) -----------------------------
    let reservationId: string | null = null;
    if (proposal.maxCostUsd > 0) {
      const r = costGuard.reserve(taskId, req.agentId, proposal.maxCostUsd, this.now());
      if (!r.ok) return deny("COST", r.reason, { policy, authorization: auth });
      reservationId = r.reservation.id;
    }
    record = raiseLadder(record, "EXECUTABLE", reservationId ? `reservation:${reservationId}` : "free:no-reservation", this.now());

    // ---- EXECUTION (single-use grant burns here) -------------------------
    record = advance(record, "EXECUTION", this.now(), `boundary=${boundary.id} mode=${boundary.mode}`);
    if (auth.stamp) {
      const g = grants.find((x) => x.id === auth.stamp!.grantId);
      if (g) this.cfg.onGrantConsumed?.(consumeGrant(g, this.now()));
    }
    let observation: Observation;
    try {
      observation = await runAction(boundary, { proposal, policy, authorization: auth, reservationId }, this.now);
    } catch (err) {
      if (reservationId) costGuard.release(reservationId, this.now(), "execution refused");
      const code = err instanceof NexaError ? err.code : err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "ERROR";
      return deny("EXECUTION", `${code}: ${err instanceof Error ? err.message : String(err)}`, { policy, authorization: auth, reservationId });
    }
    if (this.cfg.resourceGuard && requestsResource) this.cfg.resourceGuard.record(requestsResource, 1);
    const spendResource = this.cfg.resources?.[cap.provider]?.spendUsd;
    if (this.cfg.resourceGuard && spendResource && observation.costUsd > 0) this.cfg.resourceGuard.record(spendResource, observation.costUsd);
    if (reservationId) costGuard.settle(reservationId, observation.costUsd, this.now());

    // ---- OBSERVATION → VERIFICATION → EVIDENCE → MEMORY ------------------
    record = advance(record, "OBSERVATION", this.now(), `ok=${observation.ok} cost=${observation.costUsd} side_effects=${observation.sideEffects.length}`);
    record = raiseLadder(record, "EXECUTED", `observation:${sha256Hex(canonicalJson({ s: observation.summary, ok: observation.ok, c: observation.costUsd })).slice(0, 12)}`, this.now());
    const verified = observation.ok && (proposal.risk !== "read" || observation.sideEffects.length === 0) && observation.costUsd <= proposal.maxCostUsd + 1e-9;
    record = advance(record, "VERIFICATION", this.now(), verified ? "observation consistent with proposal" : "observation not verified");
    if (verified) record = raiseLadder(record, "VERIFIED", `verification:${proposal.id}`, this.now());
    record = advance(record, "EVIDENCE", this.now(), null);
    record = advance(record, "MEMORY", this.now(), "no memory backend in GEN-1 (receipt only)");
    return this.finish(record, { registryState, outcome: "EXECUTED", verified, deniedAt: null, reason: null, policy, authorization: auth, reservationId, observation });
  }

  private finish(record: ActionRecord, p: Partial_): EvidenceReceipt {
    assertLadderConsistent(record);
    const at = this.now();
    const { proposal } = record;
    const actionId = `action:${proposal.id}`;
    const hash = proposalHash(proposal);
    this.graph.action(this.cfg.taskId, actionId, at, {
      capability: proposal.capability,
      operation: proposal.operation,
      argumentKeys: Object.keys(proposal.arguments),
      risk: proposal.risk,
      dataClass: proposal.dataClass,
      maxCostUsd: proposal.maxCostUsd,
      proposalHash: hash,
      proposedBy: proposal.proposedBy,
      outcome: p.outcome,
      deniedAt: p.deniedAt,
      reason: p.reason,
      stage: record.stage,
      ladder: record.ladder,
      registryState: p.registryState ?? null,
      history: record.history,
    });
    if (p.policy) this.graph.evidence(actionId, `${actionId}:policy`, at, { decision: p.policy.decision, findings: p.policy.findings });
    if (p.authorization?.authorized) this.graph.authorization(actionId, `${actionId}:authorization`, at, { basis: p.authorization.basis, stamp: p.authorization.stamp });
    if (p.observation) {
      const o = p.observation;
      this.graph.evidence(actionId, `${actionId}:observation`, at, { executor: o.executor, mode: o.mode, ok: o.ok, summary: o.summary, costUsd: o.costUsd, sideEffects: o.sideEffects.length, startedAt: o.startedAt, endedAt: o.endedAt });
      if (o.sideEffects.length) this.graph.change(actionId, `${actionId}:change`, at, { sideEffects: o.sideEffects });
    }
    this.graph.verification(actionId, `${actionId}:verification`, at, { verified: p.verified, outcome: p.outcome, stage: record.stage, ladder: record.ladder });
    const receipt: EvidenceReceipt = {
      actionId,
      proposalHash: hash,
      capability: proposal.capability,
      registryState: p.registryState ?? null,
      operation: proposal.operation,
      outcome: p.outcome,
      verified: p.verified,
      stage: record.stage,
      ladder: record.ladder,
      deniedAt: p.deniedAt,
      reason: p.reason,
      policy: p.policy,
      authorization: p.authorization,
      reservationId: p.reservationId,
      observation: p.observation,
      history: record.history,
      evidenceHead: this.graph.stats().head,
    };
    this.list.push(receipt);
    return receipt;
  }
}

/** إسقاط منقّح للإيصال — للدليل والملخصات (بلا ناتج خام، بلا معاملات). */
export function receiptSummary(r: EvidenceReceipt): Record<string, unknown> {
  return {
    actionId: r.actionId,
    capability: r.capability,
    registryState: r.registryState,
    operation: r.operation,
    outcome: r.outcome,
    verified: r.verified,
    stage: r.stage,
    ladder: r.ladder,
    deniedAt: r.deniedAt,
    reason: r.reason,
    policy: r.policy?.decision ?? null,
    basis: r.authorization?.basis ?? null,
    reservationId: r.reservationId,
    cost: r.observation?.costUsd ?? 0,
    stages: r.history.map((h) => h.stage),
    proposalHash: r.proposalHash.slice(0, 12),
  };
}
