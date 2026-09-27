/**
 * Celia · core/task · **مخزن المهام** (GEN-3): الواجهة + تنفيذ في الذاكرة + محوّل نقاط التفتيش.
 * كل ما تحتاجه الإعادة والاستئناف يُحفظ: لقطة المهمة، نقاط التفتيش المسلسلة، مدخلات رسم الدليل، الموافقات، المنح، المخرجات، سجل التدقيق.
 * التنفيذ الحقيقي (SQLite) في `sqlite-store.ts`؛ D1 لاحقًا يطبّق الواجهة نفسها.
 */
import type { Entry, Grant } from "../../nexa/index.ts";
import type { ApprovalRequest } from "./approval.ts";
import type { Artifact } from "./artifact.ts";
import type { Checkpoint, CheckpointStore } from "./checkpoint.ts";
import type { Task } from "./task.ts";
import type { TaskState } from "./task-state.ts";

export type TaskSummary = { id: string; state: TaskState; goal: string; updatedAt: string; checkpointHead: string | null; evidenceChainHead: string };
export type AuditEvent = { seq?: number; taskId: string; at: string; event: string; data: Record<string, unknown> };

export interface TaskStore {
  transaction<T>(fn: () => T): T;
  saveTask(task: Task): void;
  loadTask(id: string): Task | null;
  listTasks(): TaskSummary[];
  appendCheckpoint(cp: Checkpoint): void;
  checkpoints(taskId: string): Checkpoint[];
  /** يُلحق المدخلات الجديدة فقط (بحسب seq) — الرسم إلحاقي. */
  appendEvidence(taskId: string, entries: readonly Entry[]): void;
  evidence(taskId: string): Entry[];
  saveApproval(a: ApprovalRequest): void;
  approval(id: string): ApprovalRequest | null;
  approvalsFor(taskId: string): ApprovalRequest[];
  pendingApprovals(): ApprovalRequest[];
  saveGrant(taskId: string, g: Grant): void;
  grants(taskId: string): Grant[];
  saveArtifact(a: Artifact): void;
  artifacts(taskId: string): Artifact[];
  audit(e: AuditEvent): void;
  auditLog(taskId: string): AuditEvent[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly cps = new Map<string, Checkpoint[]>();
  private readonly ev = new Map<string, Entry[]>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly grantsByTask = new Map<string, Map<string, Grant>>();
  private readonly arts = new Map<string, Artifact[]>();
  private readonly log: AuditEvent[] = [];

  transaction<T>(fn: () => T): T {
    return fn();
  }
  saveTask(task: Task): void {
    this.tasks.set(task.id, clone(task));
  }
  loadTask(id: string): Task | null {
    const t = this.tasks.get(id);
    return t ? clone(t) : null;
  }
  listTasks(): TaskSummary[] {
    return [...this.tasks.values()].map((t) => ({ id: t.id, state: t.state, goal: t.goal.text, updatedAt: t.updatedAt, checkpointHead: t.checkpointHead, evidenceChainHead: t.evidenceChainHead }));
  }
  appendCheckpoint(cp: Checkpoint): void {
    const list = this.cps.get(cp.taskId) ?? [];
    if (list.some((c) => c.seq === cp.seq)) throw new Error(`checkpoint ${cp.seq} already stored for ${cp.taskId}`);
    list.push(clone(cp));
    this.cps.set(cp.taskId, list);
  }
  checkpoints(taskId: string): Checkpoint[] {
    return clone(this.cps.get(taskId) ?? []);
  }
  appendEvidence(taskId: string, entries: readonly Entry[]): void {
    const list = this.ev.get(taskId) ?? [];
    const have = list.length;
    for (const e of entries) if (e.seq > have) list.push(clone(e));
    this.ev.set(taskId, list);
  }
  evidence(taskId: string): Entry[] {
    return clone(this.ev.get(taskId) ?? []);
  }
  saveApproval(a: ApprovalRequest): void {
    this.approvals.set(a.id, clone(a));
  }
  approval(id: string): ApprovalRequest | null {
    const a = this.approvals.get(id);
    return a ? clone(a) : null;
  }
  approvalsFor(taskId: string): ApprovalRequest[] {
    return [...this.approvals.values()].filter((a) => a.taskId === taskId).map(clone);
  }
  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()].filter((a) => a.status === "pending").map(clone);
  }
  saveGrant(taskId: string, g: Grant): void {
    const m = this.grantsByTask.get(taskId) ?? new Map<string, Grant>();
    m.set(g.id, clone(g));
    this.grantsByTask.set(taskId, m);
  }
  grants(taskId: string): Grant[] {
    return [...(this.grantsByTask.get(taskId)?.values() ?? [])].map(clone);
  }
  saveArtifact(a: Artifact): void {
    const list = this.arts.get(a.taskId) ?? [];
    if (!list.some((x) => x.id === a.id)) list.push(clone(a));
    this.arts.set(a.taskId, list);
  }
  artifacts(taskId: string): Artifact[] {
    return clone(this.arts.get(taskId) ?? []);
  }
  audit(e: AuditEvent): void {
    this.log.push({ ...clone(e), seq: this.log.length + 1 });
  }
  auditLog(taskId: string): AuditEvent[] {
    return this.log.filter((e) => e.taskId === taskId).map(clone);
  }
}

/** نقاط تفتيش تُكتب في المخزن مباشرة (بدل الذاكرة/JSONL في GEN-2). */
export class StoreCheckpoints implements CheckpointStore {
  private readonly store: TaskStore;
  private readonly taskId: string;
  private cache: Checkpoint[];
  constructor(store: TaskStore, taskId: string) {
    this.store = store;
    this.taskId = taskId;
    this.cache = store.checkpoints(taskId);
  }
  append(c: Checkpoint): void {
    this.store.appendCheckpoint(c);
    this.cache.push(c);
  }
  list(): readonly Checkpoint[] {
    return this.cache;
  }
  last(): Checkpoint | null {
    return this.cache.length ? this.cache[this.cache.length - 1]! : null;
  }
}
