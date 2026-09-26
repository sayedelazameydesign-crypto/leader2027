import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Repos } from "@/lib/repositories/interfaces";
import { emptyStore, reposFromStore, type Store } from "./memory";
import { seededStoreFrom } from "./seed";
import { withWriteThrough } from "./write-through";

/**
 * محوّل persistence بملف JSON — يعمل على خادم إنتاج طويل (next start).
 * تنويه مُثبَّت: القرص ephemeral على Vercel serverless —
 * محوّل PostgreSQL مُنجَز الآن فوق نفس الواجهة (VS5/T1 — `postgres.ts`).
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
