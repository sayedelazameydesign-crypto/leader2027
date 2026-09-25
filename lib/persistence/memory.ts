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

  return { people, volunteers, reports, users, regions, teams, campaign, cycles, audit };
}

export function createMemoryRepos(initial?: Store): Repos {
  return reposFromStore(initial ?? emptyStore());
}
