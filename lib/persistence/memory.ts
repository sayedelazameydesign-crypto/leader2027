import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  AuditRepo,
  Campaign,
  CampaignRepo,
  CyclesRepo,
  ElectionCycle,
  FieldReportsRepo,
  ListFilter,
  PeopleRepo,
  Region,
  RegionsRepo,
  Repos,
  TaskApprovalRecord,
  TaskArtifactRecord,
  TaskAttemptRecord,
  TaskCheckpoint,
  TaskGrantRecord,
  TaskHeartbeatRecord,
  TaskLeaseRecord,
  TaskRecord,
  TasksRepo,
  Team,
  TeamsRepo,
  User,
  UsersRepo,
  VolunteersRepo,
} from "@/lib/repositories/interfaces";
import type { Person } from "@/lib/domain/people/person";
import type { Volunteer } from "@/lib/domain/volunteers/volunteer";
import type { FieldReport } from "@/lib/domain/field/field-report";

export type Store = {
  people: Person[];
  volunteers: Volunteer[];
  reports: FieldReport[];
  users: User[];
  regions: Region[];
  teams: Team[];
  campaign: Campaign | null;
  cycles: ElectionCycle[];
  audit: AuditEvent[];
  /** GEN-3: المهام الدائمة — تُدمَج تلقائيًا في file/postgres عبر نفس المستند. */
  tasks: TaskRecord[];
  taskCheckpoints: TaskCheckpoint[];
  taskApprovals: TaskApprovalRecord[];
  taskGrants: TaskGrantRecord[];
  taskArtifacts: TaskArtifactRecord[];
  /** GEN-4: ملكية التنفيذ — تُدمَج تلقائيًا في file/postgres عبر نفس المستند. */
  taskLeases: TaskLeaseRecord[];
  taskHeartbeats: TaskHeartbeatRecord[];
  taskAttempts: TaskAttemptRecord[];
};

export function emptyStore(): Store {
  return {
    people: [],
    volunteers: [],
    reports: [],
    users: [],
    regions: [],
    teams: [],
    campaign: null,
    cycles: [],
    audit: [],
    tasks: [],
    taskCheckpoints: [],
    taskApprovals: [],
    taskGrants: [],
    taskArtifacts: [],
    taskLeases: [],
    taskHeartbeats: [],
    taskAttempts: [],
  };
}

function matchesFilter(
  item: { team_id?: string | null; region_id?: string | null; person_id?: string },
  filter?: ListFilter,
): boolean {
  if (!filter) return true;
  if (filter.team_id && item.team_id !== filter.team_id) return false;
  if (filter.region_id && item.region_id !== filter.region_id) return false;
  if (filter.person_id && item.person_id !== filter.person_id) return false;
  return true;
}

export function reposFromStore(store: Store): Repos {
  const now = () => new Date().toISOString();

  const people: PeopleRepo = {
    create(person) {
      const created: Person = { ...person, id: randomUUID() };
      store.people.push(created);
      return created;
    },
    getById(id) {
      return store.people.find((p) => p.id === id) ?? null;
    },
    update(id, patch) {
      const idx = store.people.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      store.people[idx] = { ...store.people[idx], ...patch, id, updated_at: now() };
      return store.people[idx];
    },
    list() {
      return [...store.people];
    },
  };

  const volunteers: VolunteersRepo = {
    create(volunteer) {
      const created: Volunteer = { ...volunteer, id: randomUUID() };
      store.volunteers.push(created);
      return created;
    },
    getById(id) {
      return store.volunteers.find((v) => v.id === id) ?? null;
    },
    update(id, patch) {
      const idx = store.volunteers.findIndex((v) => v.id === id);
      if (idx === -1) return null;
      store.volunteers[idx] = {
        ...store.volunteers[idx],
        ...patch,
        id,
        updated_at: now(),
      };
      return store.volunteers[idx];
    },
    list(filter) {
      return store.volunteers.filter((v) => matchesFilter(v, filter));
    },
    getActiveByPerson(person_id) {
      return (
        store.volunteers.find((v) => v.person_id === person_id && v.status === "active") ??
        null
      );
    },
  };

  const reports: FieldReportsRepo = {
    create(report) {
      const created: FieldReport = { ...report, id: randomUUID() };
      store.reports.push(created);
      return created;
    },
    getById(id) {
      return store.reports.find((r) => r.id === id) ?? null;
    },
    update(id, patch) {
      const idx = store.reports.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      store.reports[idx] = { ...store.reports[idx], ...patch, id, updated_at: now() };
      return store.reports[idx];
    },
    list(filter) {
      return store.reports.filter((r) => matchesFilter(r, filter));
    },
  };

  const users: UsersRepo = {
    getById(id) {
      return store.users.find((u) => u.id === id) ?? null;
    },
    getByEmail(email) {
      return store.users.find((u) => u.email === email.toLowerCase()) ?? null;
    },
    create(user) {
      const created: User = {
        ...user,
        id: randomUUID(),
        email: user.email.toLowerCase(),
      };
      store.users.push(created);
      return created;
    },
    update(id, patch) {
      const idx = store.users.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      store.users[idx] = { ...store.users[idx], ...patch, id };
      return store.users[idx];
    },
    list() {
      return [...store.users];
    },
  };

  const regions: RegionsRepo = {
    getById(id) {
      return store.regions.find((r) => r.id === id) ?? null;
    },
    list() {
      return [...store.regions];
    },
    create(region) {
      const created: Region = { ...region, id: randomUUID() };
      store.regions.push(created);
      return created;
    },
  };

  const teams: TeamsRepo = {
    getById(id) {
      return store.teams.find((t) => t.id === id) ?? null;
    },
    list() {
      return [...store.teams];
    },
    create(team) {
      const created: Team = { ...team, id: randomUUID() };
      store.teams.push(created);
      return created;
    },
  };

  const campaign: CampaignRepo = {
    get() {
      return store.campaign;
    },
    update(patch) {
      if (!store.campaign) return null;
      store.campaign = { ...store.campaign, ...patch, updated_at: now() };
      return store.campaign;
    },
  };

  const cycles: CyclesRepo = {
    getById(id) {
      return store.cycles.find((c) => c.id === id) ?? null;
    },
    list() {
      return [...store.cycles];
    },
    create(cycle) {
      const created: ElectionCycle = { ...cycle, id: randomUUID() };
      store.cycles.push(created);
      return created;
    },
    update(id, patch) {
      const idx = store.cycles.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      store.cycles[idx] = { ...store.cycles[idx], ...patch, id, updated_at: now() };
      return store.cycles[idx];
    },
  };

  const audit: AuditRepo = {
    append(event) {
      const created: AuditEvent = { ...event, id: randomUUID() };
      store.audit.push(created);
      return created;
    },
    list(filter) {
      return store.audit.filter((e) => {
        if (!filter) return true;
        if (filter.actor_id && e.actor_id !== filter.actor_id) return false;
        return true;
      });
    },
  };

  const tasks: TasksRepo = {
    createTask(task) {
      const created: TaskRecord = { ...task, id: randomUUID() };
      store.tasks.push(created);
      return created;
    },
    getTask(id) {
      return store.tasks.find((t) => t.id === id) ?? null;
    },
    updateTask(id, patch) {
      const idx = store.tasks.findIndex((t) => t.id === id);
      if (idx === -1) return null;
      store.tasks[idx] = { ...store.tasks[idx], ...patch, id };
      return store.tasks[idx];
    },
    listTasks() {
      return [...store.tasks];
    },
    appendCheckpoint(cp) {
      const created: TaskCheckpoint = { ...cp, id: randomUUID() };
      store.taskCheckpoints.push(created);
      return created;
    },
    listCheckpoints(taskId) {
      return store.taskCheckpoints.filter((c) => c.taskId === taskId).sort((a, b) => a.seq - b.seq);
    },
    createApproval(approval) {
      const created: TaskApprovalRecord = { ...approval, id: randomUUID() };
      store.taskApprovals.push(created);
      return created;
    },
    getApproval(id) {
      return store.taskApprovals.find((a) => a.id === id) ?? null;
    },
    updateApproval(id, patch) {
      const idx = store.taskApprovals.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      store.taskApprovals[idx] = { ...store.taskApprovals[idx], ...patch, id };
      return store.taskApprovals[idx];
    },
    listApprovals(taskId) {
      return store.taskApprovals.filter((a) => a.taskId === taskId);
    },
    createGrant(grant) {
      const created: TaskGrantRecord = { ...grant, id: randomUUID() };
      store.taskGrants.push(created);
      return created;
    },
    getGrant(id) {
      return store.taskGrants.find((g) => g.id === id) ?? null;
    },
    getGrantByApproval(approvalId) {
      return store.taskGrants.find((g) => g.approvalId === approvalId) ?? null;
    },
    updateGrant(id, patch) {
      const idx = store.taskGrants.findIndex((g) => g.id === id);
      if (idx === -1) return null;
      store.taskGrants[idx] = { ...store.taskGrants[idx], ...patch, id };
      return store.taskGrants[idx];
    },
    listGrants(taskId) {
      return store.taskGrants.filter((g) => g.taskId === taskId);
    },
    createArtifact(artifact) {
      const created: TaskArtifactRecord = { ...artifact, id: randomUUID() };
      store.taskArtifacts.push(created);
      return created;
    },
    listArtifacts(taskId) {
      return store.taskArtifacts.filter((a) => a.taskId === taskId);
    },
    createLease(lease) {
      const created: TaskLeaseRecord = { ...lease, id: randomUUID() };
      store.taskLeases.push(created);
      return created;
    },
    getLease(id) {
      return store.taskLeases.find((l) => l.id === id) ?? null;
    },
    updateLease(id, patch) {
      const idx = store.taskLeases.findIndex((l) => l.id === id);
      if (idx === -1) return null;
      store.taskLeases[idx] = { ...store.taskLeases[idx], ...patch, id };
      return store.taskLeases[idx];
    },
    listLeases(taskId) {
      return store.taskLeases
        .filter((l) => l.taskId === taskId)
        .sort((a, b) => a.fencingToken - b.fencingToken);
    },
    recordHeartbeat(hb) {
      const created: TaskHeartbeatRecord = { ...hb, id: randomUUID() };
      store.taskHeartbeats.push(created);
      return created;
    },
    listHeartbeats(leaseId) {
      return store.taskHeartbeats.filter((h) => h.leaseId === leaseId);
    },
    recordAttempt(attempt) {
      const created: TaskAttemptRecord = { ...attempt, id: randomUUID() };
      store.taskAttempts.push(created);
      return created;
    },
    findAttempt(taskId, stepId, proposalHash) {
      return (
        store.taskAttempts.find(
          (a) => a.taskId === taskId && a.stepId === stepId && a.proposalHash === proposalHash,
        ) ?? null
      );
    },
    listAttempts(taskId) {
      return store.taskAttempts.filter((a) => a.taskId === taskId);
    },
  };

  return { people, volunteers, reports, users, regions, teams, campaign, cycles, audit, tasks };
}

export function createMemoryRepos(initial?: Store): Repos {
  return reposFromStore(initial ?? emptyStore());
}
