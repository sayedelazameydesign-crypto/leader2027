import path from "node:path";
import type { Repos } from "@/lib/repositories/interfaces";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { createFileJsonRepos } from "@/lib/persistence/file-json";
import { createPostgresRepos } from "@/lib/persistence/postgres";
import { seededStore } from "@/lib/persistence/seed";

let override: Repos | null = null;
let memoryRepos: Repos | null = null;

/** للاختبارات والـsmoke: حقن مخزن محدد. */
export function setRepos(repos: Repos | null): void {
  override = repos;
}

/**
 * ملاحظة مُثبتة عملياً (بوابة smoke لـVS2): عوالم module في next start غير مشتركة
 * بين page-bundles وroute-handler-bundles — كاش singleton لكل عالم كان يُجمِّد
 * المخزن عند أول تحميل (warmup) ويُخفي الكتابات اللاحقة عن الصفحات.
 * لذلك وضعا file/postgres: مخزن طازج من المصدر في كل استدعاء = اتساق عبر كل العوالم.
 */
export function getRepos(): Repos {
  if (override) return override;

  const storeKind = process.env.L27_STORE ?? "file";
  if (storeKind === "memory") {
    if (!memoryRepos) {
      memoryRepos = createMemoryRepos(seededStore());
    }
    return memoryRepos;
  }

  if (storeKind === "postgres") {
    const dsn = process.env.DATABASE_URL ?? "";
    if (!dsn) throw new Error("L27_STORE=postgres يتطلب DATABASE_URL");
    return createPostgresRepos(dsn);
  }

  const dbPath =
    process.env.L27_DB_PATH ?? path.join(process.cwd(), "var", "data", "db.json");
  return createFileJsonRepos(dbPath);
}
