import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Repos } from "@/lib/repositories/interfaces";
import { emptyStore, reposFromStore, type Store } from "./memory";
import { seededStoreFrom } from "./seed";

/**
 * محوّل persistence بملف JSON — يعمل على خادم إنتاج طويل (next start).
 * تنويه مُثبَّت في الخطة: القرص ephemeral على Vercel serverless —
 * محولّ PostgreSQL يُضاف لاحقاً فوق نفس الواجهة (Repository Interface) بلا إعادة كتابة domain.
 */
export function createFileJsonRepos(path: string, seedIfEmpty = true): Repos {
  let store: Store;
  if (existsSync(path)) {
    store = { ...emptyStore(), ...JSON.parse(readFileSync(path, "utf-8")) };
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
    },
    regions: repos.regions,
    teams: repos.teams,
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
