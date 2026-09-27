import type { Person } from "@/lib/domain/people/person";
import type { Volunteer } from "@/lib/domain/volunteers/volunteer";
import type { FieldReport } from "@/lib/domain/field/field-report";
import type { Role } from "@/lib/authorization/roles";

export type Region = { id: string; name: string };
export type Team = { id: string; name: string; region_id: string | null };

export type Campaign = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type ElectionCycleStatus = "planned" | "active" | "closed";

export type ElectionCycle = {
  id: string;
  name: string;
  election_date: string;
  status: ElectionCycleStatus;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  team_id: string | null;
  region_id: string | null;
  password_hash: string;
  session_epoch: number;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  actor_id: string;
  actor_role: Role;
  action: string;
  entity_type: string;
  entity_id: string;
  at: string;
  meta: Record<string, string | number> | null;
};

export type ListFilter = {
  team_id?: string;
  region_id?: string;
  person_id?: string;
};

export interface PeopleRepo {
  create(person: Omit<Person, "id">): Person;
  getById(id: string): Person | null;
  update(id: string, patch: Partial<Person>): Person | null;
  list(): Person[];
}

export interface VolunteersRepo {
  create(volunteer: Omit<Volunteer, "id">): Volunteer;
  getById(id: string): Volunteer | null;
  update(id: string, patch: Partial<Volunteer>): Volunteer | null;
  list(filter?: ListFilter): Volunteer[];
  getActiveByPerson(person_id: string): Volunteer | null;
}

export interface FieldReportsRepo {
  create(report: Omit<FieldReport, "id">): FieldReport;
  getById(id: string): FieldReport | null;
  update(id: string, patch: Partial<FieldReport>): FieldReport | null;
  list(filter?: ListFilter): FieldReport[];
}

export interface UsersRepo {
  getById(id: string): User | null;
  getByEmail(email: string): User | null;
  create(user: Omit<User, "id">): User;
  update(id: string, patch: Partial<User>): User | null;
  list(): User[];
}

export interface RegionsRepo {
  getById(id: string): Region | null;
  list(): Region[];
  create(region: Omit<Region, "id">): Region;
}

export interface TeamsRepo {
  getById(id: string): Team | null;
  list(): Team[];
  create(team: Omit<Team, "id">): Team;
}

export interface CampaignRepo {
  get(): Campaign | null;
  update(patch: Partial<Pick<Campaign, "name">>): Campaign | null;
}

export interface CyclesRepo {
  getById(id: string): ElectionCycle | null;
  list(): ElectionCycle[];
  create(cycle: Omit<ElectionCycle, "id">): ElectionCycle;
  update(id: string, patch: Partial<ElectionCycle>): ElectionCycle | null;
}

export interface AuditRepo {
  append(event: Omit<AuditEvent, "id">): AuditEvent;
  list(filter?: ListFilter & { actor_id?: string }): AuditEvent[];
}

/* ------------------------------------------------ GEN-3: محرك المهام الدائم
 *
 * سجلات المهمة camelCase حسب عقد GEN-3 (§4) — سياق محدود جديد، لا يمسّ
 * اصطلاح snake_case لسجلات النطاق القائمة.
 */

export type TaskStatus =
  | "CREATED"
  | "UNDERSTANDING"
  | "PLANNING"
  | "READY"
  | "EXECUTING"
  | "OBSERVING"
  | "VERIFYING"
  | "RECOVERING"
  | "REPLANNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "PARTIAL"
  | "BLOCKED";

export type PlannedStepStatus = "pending" | "running" | "observed" | "verified" | "failed";

export type PlannedStep = {
  id: string;
  operation: string;
  costCap: number;
  requiresApproval: boolean;
  status: PlannedStepStatus;
};

export type TaskRecord = {
  id: string;
  goal: string;
  status: TaskStatus;
  plan: PlannedStep[];
  checkpointHead: string;
  evidenceChainHead: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskCheckpoint = {
  id: string;
  taskId: string;
  seq: number;
  state: TaskStatus;
  stepId: string | null;
  context: Record<string, unknown>;
  prevHash: string;
  hash: string;
  evidenceHead: string;
  at: string;
};

export type TaskApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type TaskApprovalRecord = {
  id: string;
  taskId: string;
  stepId: string;
  proposalHash: string;
  operation: string;
  costCap: number;
  status: TaskApprovalStatus;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type TaskGrantRecord = {
  id: string;
  approvalId: string;
  taskId: string;
  stepId: string;
  proposalHash: string;
  operation: string;
  costCap: number;
  createdAt: string;
  consumedAt: string | null;
};

export type TaskArtifactRecord = {
  id: string;
  taskId: string;
  stepId: string;
  type: string;
  ref: string;
  evidenceHash: string;
  createdAt: string;
};

/* ------------------------------------------------ GEN-4: ملكية التنفيذ الموزّع
 *
 * Leases + Heartbeats + Attempts — صفوف في نفس `Store` (المصدر الوحيد للحقيقة،
 * D1). لا حالة ملكية في ذاكرة أي worker.
 */

export type TaskLeaseRecord = {
  id: string;
  taskId: string;
  workerId: string;
  /** رقم تصاعدي لكل lease جديد على نفس المهمة — الأحدث يكسب (fencing). */
  fencingToken: number;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  /** طابع التسليم الطوعي — null تعني: انتهى أو ما زال نشطًا. */
  releasedAt: string | null;
};

export type TaskHeartbeatRecord = {
  id: string;
  leaseId: string;
  taskId: string;
  workerId: string;
  at: string;
};

export type TaskAttemptStatus = "executed";

export type TaskAttemptRecord = {
  id: string;
  taskId: string;
  stepId: string;
  /** بصمة المقترح القانوني — مفتاح الـidempotency المستقر عبر الحقب. */
  proposalHash: string;
  /** بصمة (المقترح + الـfencing) — توثّق أي حقبة نفّذت. */
  attemptToken: string;
  fencingToken: number;
  status: TaskAttemptStatus;
  /** ملخص الدليل المسجَّل — يُعاد استعماله عند الاسترداد mid-step بدل إعادة النداء. */
  evidenceHash: string;
  /** النتيجة المقنّعة (§5-نظيفة) — مادة الاسترداد mid-step بلا إعادة نداء. */
  result: unknown;
  recordedAt: string;
};

export interface TasksRepo {
  createTask(task: Omit<TaskRecord, "id">): TaskRecord;
  getTask(id: string): TaskRecord | null;
  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord | null;
  listTasks(): TaskRecord[];
  appendCheckpoint(cp: Omit<TaskCheckpoint, "id">): TaskCheckpoint;
  listCheckpoints(taskId: string): TaskCheckpoint[];
  createApproval(approval: Omit<TaskApprovalRecord, "id">): TaskApprovalRecord;
  getApproval(id: string): TaskApprovalRecord | null;
  updateApproval(id: string, patch: Partial<TaskApprovalRecord>): TaskApprovalRecord | null;
  listApprovals(taskId: string): TaskApprovalRecord[];
  createGrant(grant: Omit<TaskGrantRecord, "id">): TaskGrantRecord;
  getGrant(id: string): TaskGrantRecord | null;
  getGrantByApproval(approvalId: string): TaskGrantRecord | null;
  updateGrant(id: string, patch: Partial<TaskGrantRecord>): TaskGrantRecord | null;
  listGrants(taskId: string): TaskGrantRecord[];
  createArtifact(artifact: Omit<TaskArtifactRecord, "id">): TaskArtifactRecord;
  listArtifacts(taskId: string): TaskArtifactRecord[];
  /* GEN-4 */
  createLease(lease: Omit<TaskLeaseRecord, "id">): TaskLeaseRecord;
  getLease(id: string): TaskLeaseRecord | null;
  updateLease(id: string, patch: Partial<TaskLeaseRecord>): TaskLeaseRecord | null;
  listLeases(taskId: string): TaskLeaseRecord[];
  recordHeartbeat(hb: Omit<TaskHeartbeatRecord, "id">): TaskHeartbeatRecord;
  listHeartbeats(leaseId: string): TaskHeartbeatRecord[];
  recordAttempt(attempt: Omit<TaskAttemptRecord, "id">): TaskAttemptRecord;
  findAttempt(taskId: string, stepId: string, proposalHash: string): TaskAttemptRecord | null;
  listAttempts(taskId: string): TaskAttemptRecord[];
}

export type Repos = {
  people: PeopleRepo;
  volunteers: VolunteersRepo;
  reports: FieldReportsRepo;
  users: UsersRepo;
  regions: RegionsRepo;
  teams: TeamsRepo;
  campaign: CampaignRepo;
  cycles: CyclesRepo;
  audit: AuditRepo;
  tasks: TasksRepo;
};
