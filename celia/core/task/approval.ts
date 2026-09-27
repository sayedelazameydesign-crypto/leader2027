/**
 * Celia · core/task · **الموافقات = منح بشرية معلّقة** (GEN-3).
 *
 * دخول WAITING_APPROVAL يخزّن ApprovalRequest مربوطًا بـ proposalHash + operation + costCap (قرار GEN-1 §3).
 * الموافقة (إنسان فقط) تولّد Grant أحادي الاستعمال بشكل NEXA نفسه؛ الرفض/الانتهاء fail-closed.
 * لا RBAC هنا (خارج نطاق GEN-3): `decidedBy` اسم حر، و`principal` يجب أن يكون "human".
 */
import { NexaError, type Grant, type GrantPrincipal, type RiskLevel } from "../../nexa/index.ts";
import type { TaskStore } from "./store.ts";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRequest = {
  id: string;
  taskId: string;
  stepId: string;
  capability: string;
  operation: string;
  proposalHash: string;
  costCap: number;
  risk: RiskLevel;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decision: string | null;
  grantId: string | null;
};

export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export class ApprovalService {
  private readonly store: TaskStore;
  constructor(store: TaskStore) {
    this.store = store;
  }

  request(input: Omit<ApprovalRequest, "id" | "status" | "requestedAt" | "expiresAt" | "decidedAt" | "decidedBy" | "decision" | "grantId"> & { now: string; ttlMs?: number }): ApprovalRequest {
    const { now, ttlMs, ...rest } = input;
    const existing = this.store.approvalsFor(rest.taskId).find((a) => a.status === "pending" && a.proposalHash === rest.proposalHash && a.stepId === rest.stepId);
    if (existing) return existing;
    const n = this.store.approvalsFor(rest.taskId).length + 1;
    const a: ApprovalRequest = { id: `approval:${rest.taskId}:${n}`, ...rest, status: "pending", requestedAt: now, expiresAt: new Date(Date.parse(now) + (ttlMs ?? DEFAULT_APPROVAL_TTL_MS)).toISOString(), decidedAt: null, decidedBy: null, decision: null, grantId: null };
    this.store.saveApproval(a);
    this.store.audit({ taskId: a.taskId, at: now, event: "approval.requested", data: { id: a.id, stepId: a.stepId, operation: a.operation, proposalHash: a.proposalHash, costCap: a.costCap, expiresAt: a.expiresAt } });
    return a;
  }

  get(id: string): ApprovalRequest | null {
    return this.store.approval(id);
  }

  /** موافقة بشرية ⇒ منح أحادي الاستعمال مربوط بالكامل (proposalHash + operation + سقف التكلفة). */
  approve(id: string, by: { decidedBy: string; principal: GrantPrincipal; now: string; role?: string }): { approval: ApprovalRequest; grant: Grant } {
    const a = this.mustPending(id, by.now);
    if (by.principal !== "human") throw new NexaError("APPROVAL_PRINCIPAL", `only a human can approve (got ${by.principal}) — no AI/agent/planner/provider approval`);
    if (!by.decidedBy.trim()) throw new NexaError("APPROVAL_PRINCIPAL", "decidedBy must name the human");
    const grant: Grant = {
      id: `grant:${a.id}`,
      grantedBy: by.decidedBy,
      principal: "human",
      role: by.role ?? "owner",
      scope: { capability: a.capability, operation: a.operation, proposalHash: a.proposalHash },
      maxCostUsd: a.costCap,
      expiresAt: a.expiresAt,
      singleUse: true,
      usedAt: null,
    };
    const approval: ApprovalRequest = { ...a, status: "approved", decidedAt: by.now, decidedBy: by.decidedBy, decision: "approved", grantId: grant.id };
    this.store.transaction(() => {
      this.store.saveGrant(a.taskId, grant);
      this.store.saveApproval(approval);
      this.store.audit({ taskId: a.taskId, at: by.now, event: "approval.approved", data: { id: a.id, by: by.decidedBy, grantId: grant.id } });
    });
    return { approval, grant };
  }

  reject(id: string, by: { decidedBy: string; principal: GrantPrincipal; now: string; reason?: string }): ApprovalRequest {
    const a = this.mustPending(id, by.now);
    if (by.principal !== "human") throw new NexaError("APPROVAL_PRINCIPAL", `only a human can decide (got ${by.principal})`);
    const approval: ApprovalRequest = { ...a, status: "rejected", decidedAt: by.now, decidedBy: by.decidedBy, decision: by.reason ?? "rejected" };
    this.store.saveApproval(approval);
    this.store.audit({ taskId: a.taskId, at: by.now, event: "approval.rejected", data: { id: a.id, by: by.decidedBy, reason: approval.decision } });
    return approval;
  }

  /** انتهاء الصلاحية fail-closed: يُطبَّق عند القراءة، لا يحتاج مؤقّتًا. */
  expireDue(now: string): ApprovalRequest[] {
    const out: ApprovalRequest[] = [];
    for (const a of this.store.pendingApprovals()) {
      if (a.expiresAt <= now) {
        const expired: ApprovalRequest = { ...a, status: "expired", decidedAt: now, decidedBy: null, decision: "expired" };
        this.store.saveApproval(expired);
        this.store.audit({ taskId: a.taskId, at: now, event: "approval.expired", data: { id: a.id } });
        out.push(expired);
      }
    }
    return out;
  }

  private mustPending(id: string, now: string): ApprovalRequest {
    const a = this.store.approval(id);
    if (!a) throw new NexaError("APPROVAL_UNKNOWN", `unknown approval ${id}`);
    if (a.status === "pending" && a.expiresAt <= now) {
      this.expireDue(now);
      throw new NexaError("APPROVAL_EXPIRED", `approval ${id} expired at ${a.expiresAt}`);
    }
    if (a.status !== "pending") throw new NexaError("APPROVAL_DECIDED", `approval ${id} is already ${a.status}`);
    return a;
  }
}
