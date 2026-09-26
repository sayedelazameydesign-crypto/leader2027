// استيراد حيّ لـ`pg` رغم أن الاستعلامات تمرّ عبر الأبن — يضمن تتبّع الحزمة (nft)
// على Vercel فلا تُسقط `pg` من حزمة الدوال. الاستيراد مستعمل في الأبن فعليًا.
import * as pg from "pg";
import type { Repos } from "@/lib/repositories/interfaces";
import { emptyStore, reposFromStore, type Store } from "./memory";
import { seededStoreFrom } from "./seed";
import { withWriteThrough } from "./write-through";
import { syncQuery } from "./sync-pg";

void pg;

const ROW_ID = "default";

/**
 * محوّل PostgreSQL فوق نفس `Repository Interface` — VS5/T1.
 *
 * الدلالات **مطابقة حرفيًا** لـ`createFileJsonRepos`:
 *   - مستند Store كامل يُحمَّل طازجًا عند كل `getRepos()` (اتساق عوالم module).
 *   - write-through بعد كل mutation (الكتابة تكتمل قبل عودة الاستدعاء).
 *   - بذر أولي عند أول تشغيل على قاعدة فارغة (`seedIfEmpty`).
 *   - LWW على مستوى المستند عند الكتابة المتزامنة — نفس سلوك الملف، موثّق في العقد.
 *
 * الواجهة المتزامنة تُحفَظ عبر جسر `spawnSync` (`sync-pg.ts`) — بلا تعديل على domain.
 */
export function createPostgresRepos(dsn: string, seedIfEmpty = true): Repos {
  ensureSchema(dsn);

  let store: Store;
  const existing = load(dsn);
  if (existing) {
    store = normalize(existing);
  } else {
    store = seedIfEmpty ? seededStoreFrom() : emptyStore();
    save(dsn, store);
  }

  return withWriteThrough(reposFromStore(store), () => save(dsn, store));
}

function ensureSchema(dsn: string): void {
  syncQuery(
    `CREATE TABLE IF NOT EXISTS l27_store (
       id         TEXT PRIMARY KEY,
       doc        JSONB NOT NULL,
       version    BIGINT NOT NULL DEFAULT 0,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    [],
    dsn,
  );
}

function load(dsn: string): Store | null {
  const { rows } = syncQuery("SELECT doc FROM l27_store WHERE id = $1", [ROW_ID], dsn);
  if (rows.length === 0) return null;
  return rows[0].doc as Store;
}

function save(dsn: string, store: Store): void {
  syncQuery(
    `INSERT INTO l27_store (id, doc, version, updated_at)
     VALUES ($1, $2::jsonb, 1, now())
     ON CONFLICT (id) DO UPDATE
       SET doc = EXCLUDED.doc, version = l27_store.version + 1, updated_at = now()`,
    [ROW_ID, JSON.stringify(store)],
    dsn,
  );
}

/** توافق قدماء — نفس قواعد `createFileJsonRepos` لملفات/مستندات أقدم. */
function normalize(raw: Store): Store {
  const store: Store = { ...emptyStore(), ...raw };
  store.users = store.users.map((u) => ({ ...u, session_epoch: u.session_epoch ?? 0 }));
  if (!store.campaign) {
    const t = new Date().toISOString();
    store.campaign = { id: "campaign-1", name: "حملة Leader 2027", created_at: t, updated_at: t };
  }
  if (!store.cycles) store.cycles = [];
  return store;
}
