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
};
