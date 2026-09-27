/**
 * NEXA — التفويض والموافقة (Authorization & Approval).
 *
 * «Authorization permits» — منفصل عن «Policy decides»:
 *   - سياسة DENY ⇒ لا تفويض مهما كانت المنح.
 *   - سياسة ADMIT لفعل قراءة ⇒ تفويض بلا موافقة بشرية (مُسجَّل صراحةً).
 *   - سياسة REQUIRE_APPROVAL ⇒ يلزم **منح** (Grant) بشري مطابق: القدرة، والعملية إن حُدِّدت،
 *     وتجزئة الاقتراح إن حُدِّدت، غير منتهٍ، غير مستهلك، وسقفه ≥ سقف الاقتراح.
 *   - المنح **يُستهلك مرة واحدة** (single-use) — نفس دلالة `kernel.approvals` في Leader 2027.
 */
import { NexaError, proposalHash, type Proposal } from "./protocol.ts";
import type { PolicyDecision } from "./policy.ts";

export type Grant = {
  id: string;
  grantedBy: string;
  role: string;
  scope: { capability: string; operation: string | null; proposalHash: string | null };
  maxCostUsd: number;
  expiresAt: string;
  singleUse: boolean;
  usedAt: string | null;
};

export type ApprovalStamp = {
  grantId: string;
  proposalHash: string;
  approvedBy: string;
  role: string;
  at: string;
};

export type AuthorizationResult = {
  authorized: boolean;
  /** "policy" = قراءة مقبولة بلا موافقة · "grant" = موافقة بشرية · null = غير مفوَّض. */
  basis: "policy" | "grant" | null;
  stamp: ApprovalStamp | null;
  reasons: string[];
};

export function grantMatches(grant: Grant, proposal: Proposal, now: string): { ok: boolean; why: string } {
  if (grant.scope.capability !== proposal.capability) return { ok: false, why: `grant ${grant.id}: capability mismatch` };
  if (grant.scope.operation !== null && grant.scope.operation !== proposal.operation) return { ok: false, why: `grant ${grant.id}: operation mismatch` };
  const hash = proposalHash(proposal);
  if (grant.scope.proposalHash !== null && grant.scope.proposalHash !== hash) return { ok: false, why: `grant ${grant.id}: bound to a different proposal` };
  if (grant.expiresAt <= now) return { ok: false, why: `grant ${grant.id}: expired` };
  if (grant.singleUse && grant.usedAt !== null) return { ok: false, why: `grant ${grant.id}: already consumed` };
  if (grant.maxCostUsd < proposal.maxCostUsd) return { ok: false, why: `grant ${grant.id}: cap ${grant.maxCostUsd} < proposal ${proposal.maxCostUsd}` };
  return { ok: true, why: `grant ${grant.id}: matches` };
}

export function authorize(proposal: Proposal, policy: PolicyDecision, grants: readonly Grant[], now: string): AuthorizationResult {
  if (policy.decision === "DENY") {
    return { authorized: false, basis: null, stamp: null, reasons: ["policy denied", ...policy.findings.filter((f) => f.severity === "deny").map((f) => f.reason)] };
  }
  if (policy.decision === "ADMIT") {
    if (proposal.risk !== "read") {
      // دفاع في العمق: لا يجوز أن تُقبل كتابة بلا موافقة حتى لو أخطأت مجموعة قواعد مخصصة.
      return { authorized: false, basis: null, stamp: null, reasons: [`policy admitted a ${proposal.risk} action without approval — refused by authorization`] };
    }
    return { authorized: true, basis: "policy", stamp: null, reasons: ["read action admitted by policy; no human approval required"] };
  }
  const reasons: string[] = [];
  for (const g of grants) {
    const m = grantMatches(g, proposal, now);
    reasons.push(m.why);
    if (m.ok) {
      return {
        authorized: true,
        basis: "grant",
        stamp: { grantId: g.id, proposalHash: proposalHash(proposal), approvedBy: g.grantedBy, role: g.role, at: now },
        reasons,
      };
    }
  }
  return { authorized: false, basis: null, stamp: null, reasons: ["approval required: no matching grant", ...reasons] };
}

/** استهلاك المنح — مرة واحدة؛ يُستدعى عند عبور حدّ التنفيذ لا قبله. */
export function consumeGrant(grant: Grant, now: string): Grant {
  if (grant.singleUse && grant.usedAt !== null) throw new NexaError("GRANT_CONSUMED", `grant ${grant.id} already consumed at ${grant.usedAt}`);
  return { ...grant, usedAt: now };
}
