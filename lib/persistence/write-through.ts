import type { Repos } from "@/lib/repositories/interfaces";

/**
 * غلاف write-through مشترك للمحوّلات — كل mutation يُحفَظ فورًا عبر `flush()`.
 * يُستعمله محوّلا `file` و`postgres` — دلالات واحدة حرفًا (VS5/T1).
 */
export function withWriteThrough(repos: Repos, flush: () => void): Repos {
  return {
    people: {
      ...repos.people,
      create(person) {
        const created = repos.people.create(person);
        flush();
        return created;
      },
      update(id, patch) {
        const updated = repos.people.update(id, patch);
        flush();
        return updated;
      },
    },
    volunteers: {
      ...repos.volunteers,
      create(volunteer) {
        const created = repos.volunteers.create(volunteer);
        flush();
        return created;
      },
      update(id, patch) {
        const updated = repos.volunteers.update(id, patch);
        flush();
        return updated;
      },
    },
    reports: {
      ...repos.reports,
      create(report) {
        const created = repos.reports.create(report);
        flush();
        return created;
      },
      update(id, patch) {
        const updated = repos.reports.update(id, patch);
        flush();
        return updated;
      },
    },
    users: {
      ...repos.users,
      create(user) {
        const created = repos.users.create(user);
        flush();
        return created;
      },
      update(id, patch) {
        const updated = repos.users.update(id, patch);
        flush();
        return updated;
      },
    },
    regions: {
      ...repos.regions,
      create(region) {
        const created = repos.regions.create(region);
        flush();
        return created;
      },
    },
    teams: {
      ...repos.teams,
      create(team) {
        const created = repos.teams.create(team);
        flush();
        return created;
      },
    },
    campaign: {
      ...repos.campaign,
      update(patch) {
        const updated = repos.campaign.update(patch);
        flush();
        return updated;
      },
    },
    cycles: {
      ...repos.cycles,
      create(cycle) {
        const created = repos.cycles.create(cycle);
        flush();
        return created;
      },
      update(id, patch) {
        const updated = repos.cycles.update(id, patch);
        flush();
        return updated;
      },
    },
    audit: {
      ...repos.audit,
      append(event) {
        const created = repos.audit.append(event);
        flush();
        return created;
      },
    },
  };
}
