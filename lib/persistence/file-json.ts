import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Repos } from "@/lib/repositories/interfaces";
import { emptyStore, reposFromStore, type Store } from "./memory";
import { seededStoreFrom } from "./seed";

/**
 * محوّل persistence بملف JSON — يعمل على خادم إنتاج طويل (next start).
 * تنويه مُثبَّت: القرص ephemeral على Vercel serverless —
 * محولّ PostgreSQL يُضاف لاحقاً فوق نفس الواجهة (Repository Interface) بلا إعادة كتابة domain.
 */
export function createFileJsonRepos(path: string, seedIfEmpty = true): Repos {
  let store: Store;
  if (existsSync(path)) {
    store = { ...emptyStore(), ...JSON.parse(readFileSync(path, "utf-8")) };
    // توافق قدماء: ملفات قديمة بلا session_epoch
    store.users = store.users.map((u) => ({ ...u, session_epoch: u.session_epoch ?? 0 }));
    // توافق قدماء: ملفات أُنشئت قبل VS3 — حملة singleton + دورات فارغة (نفس قيم seed)
    if (!store.campaign) {
      const t = new Date().toISOString();
      store.campaign = { id: "campaign-1", name: "حملة Leader 2027", created_at: t, updated_at: t };
    }
    if (!store.cycles) store.cycles = [];
  } else {
    store = seedIfEmpty ? seededStoreFrom() : emptyStore();
  }

  const flush = () => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    renameSync(tmp, path);
  };
  flush();

  return withWriteThrough(reposFromStore(store), flush);
}

function withWriteThrough(repos: Repos, flush: () => void): Repos {
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
