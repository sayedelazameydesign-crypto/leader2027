/**
 * Celia · core/task · **مخزن SQLite** (GEN-3) فوق `node:sqlite` المدمج (Node ≥ 22.13، بلا تبعيات) — مجاني، ملف واحد،
 * ومتوافق دلاليًا مع Cloudflare D1 لاحقًا. كل انتقال حالة يُكتب في معاملة واحدة: نقطة تفتيش + مدخلات دليل + لقطة المهمة.
 */
import { DatabaseSync } from "node:sqlite";
import type { Entry, Grant } from "../../nexa/index.ts";
import type { ApprovalRequest } from "./approval.ts";
import type { Artifact } from "./artifact.ts";
import type { Checkpoint } from "./checkpoint.ts";
import type { AuditEvent, TaskStore, TaskSummary } from "./store.ts";
import type { Task } from "./task.ts";
import type { TaskState } from "./task-state.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, state TEXT NOT NULL, goal TEXT NOT NULL, json TEXT NOT NULL, checkpoint_head TEXT, evidence_head TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (task_id TEXT NOT NULL, seq INTEGER NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (task_id, seq));
CREATE TABLE IF NOT EXISTS evidence (task_id TEXT NOT NULL, seq INTEGER NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (task_id, seq));
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, used_at TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_id TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, at TEXT NOT NULL, event TEXT NOT NULL, json TEXT NOT NULL);
`;

type Row = Record<string, unknown>;

export class SqliteTaskStore implements TaskStore {
  readonly path: string;
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(path: string = ":memory:") {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn(); // معاملة متداخلة: تنضم للخارجية
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth--;
    }
  }

  saveTask(task: Task): void {
    this.db
      .prepare("INSERT INTO tasks (id, state, goal, json, checkpoint_head, evidence_head, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, json = excluded.json, checkpoint_head = excluded.checkpoint_head, evidence_head = excluded.evidence_head, updated_at = excluded.updated_at")
      .run(task.id, task.state, task.goal.text, JSON.stringify(task), task.checkpointHead, task.evidenceChainHead, task.createdAt, task.updatedAt);
  }
  loadTask(id: string): Task | null {
    const row = this.db.prepare("SELECT json FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(String(row.json)) as Task) : null;
  }
  listTasks(): TaskSummary[] {
    return (this.db.prepare("SELECT id, state, goal, updated_at, checkpoint_head, evidence_head FROM tasks ORDER BY updated_at").all() as Row[]).map((r) => ({ id: String(r.id), state: String(r.state) as TaskState, goal: String(r.goal), updatedAt: String(r.updated_at), checkpointHead: r.checkpoint_head === null ? null : String(r.checkpoint_head), evidenceChainHead: String(r.evidence_head) }));
  }
  appendCheckpoint(cp: Checkpoint): void {
    this.db.prepare("INSERT INTO checkpoints (task_id, seq, hash, state, json) VALUES (?, ?, ?, ?, ?)").run(cp.taskId, cp.seq, cp.hash, cp.state, JSON.stringify(cp));
  }
  checkpoints(taskId: string): Checkpoint[] {
    return (this.db.prepare("SELECT json FROM checkpoints WHERE task_id = ? ORDER BY seq").all(taskId) as Row[]).map((r) => JSON.parse(String(r.json)) as Checkpoint);
  }
  appendEvidence(taskId: string, entries: readonly Entry[]): void {
    const have = Number((this.db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE task_id = ?").get(taskId) as Row).n);
    const ins = this.db.prepare("INSERT INTO evidence (task_id, seq, hash, json) VALUES (?, ?, ?, ?)");
    for (const e of entries) if (e.seq > have) ins.run(taskId, e.seq, e.hash, JSON.stringify(e));
  }
  evidence(taskId: string): Entry[] {
    return (this.db.prepare("SELECT json FROM evidence WHERE task_id = ? ORDER BY seq").all(taskId) as Row[]).map((r) => JSON.parse(String(r.json)) as Entry);
  }
  saveApproval(a: ApprovalRequest): void {
    this.db.prepare("INSERT INTO approvals (id, task_id, status, expires_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at, json = excluded.json").run(a.id, a.taskId, a.status, a.expiresAt, JSON.stringify(a));
  }
  approval(id: string): ApprovalRequest | null {
    const row = this.db.prepare("SELECT json FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(String(row.json)) as ApprovalRequest) : null;
  }
  approvalsFor(taskId: string): ApprovalRequest[] {
    return (this.db.prepare("SELECT json FROM approvals WHERE task_id = ? ORDER BY rowid").all(taskId) as Row[]).map((r) => JSON.parse(String(r.json)) as ApprovalRequest);
  }
  pendingApprovals(): ApprovalRequest[] {
    return (this.db.prepare("SELECT json FROM approvals WHERE status = 'pending' ORDER BY rowid").all() as Row[]).map((r) => JSON.parse(String(r.json)) as ApprovalRequest);
  }
  saveGrant(taskId: string, g: Grant): void {
    this.db.prepare("INSERT INTO grants (id, task_id, used_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET used_at = excluded.used_at, json = excluded.json").run(g.id, taskId, g.usedAt, JSON.stringify(g));
  }
  grants(taskId: string): Grant[] {
    return (this.db.prepare("SELECT json FROM grants WHERE task_id = ? ORDER BY rowid").all(taskId) as Row[]).map((r) => JSON.parse(String(r.json)) as Grant);
  }
  saveArtifact(a: Artifact): void {
    this.db.prepare("INSERT OR IGNORE INTO artifacts (id, task_id, step_id, json) VALUES (?, ?, ?, ?)").run(a.id, a.taskId, a.stepId, JSON.stringify(a));
  }
  artifacts(taskId: string): Artifact[] {
    return (this.db.prepare("SELECT json FROM artifacts WHERE task_id = ? ORDER BY rowid").all(taskId) as Row[]).map((r) => JSON.parse(String(r.json)) as Artifact);
  }
  audit(e: AuditEvent): void {
    this.db.prepare("INSERT INTO audit (task_id, at, event, json) VALUES (?, ?, ?, ?)").run(e.taskId, e.at, e.event, JSON.stringify(e.data));
  }
  auditLog(taskId: string): AuditEvent[] {
    return (this.db.prepare("SELECT seq, task_id, at, event, json FROM audit WHERE task_id = ? ORDER BY seq").all(taskId) as Row[]).map((r) => ({ seq: Number(r.seq), taskId: String(r.task_id), at: String(r.at), event: String(r.event), data: JSON.parse(String(r.json)) as Record<string, unknown> }));
  }
}
