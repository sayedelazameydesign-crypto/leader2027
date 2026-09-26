/**
 * جسر استعلام متزامن إلى PostgreSQL — VS5/T1.
 *
 * لماذا؟ واجهة `Repos` **متزامنة بالعقد** (domain + kernel bridge لا يتغيّران)،
 * بينما عملاء Postgres في Node غير متزامنين. هذا الجسر ينفذ استعلامًا واحدًا
 * في أبن `node` منفصل عبر `spawnSync` — الكتابة تكتمل قبل عودة الطلب (write-through
 * حقيقية، لا write-behind)، وبنفس دورة «مصدر طازج لكل استدعاء» في وضع file.
 *
 * الأمان: الأبن يعمل باستعلام واحد ثم يخرج — لا حالة بين الاستدعاءات.
 * DSN يمرّ عبر البيئة (`DATABASE_URL`) لا عبر argv.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type QueryResult = { rows: Record<string, unknown>[] };

const CHILD = path.join(process.cwd(), "lib", "persistence", "pg-child.mjs");
const TIMEOUT_MS = 20_000;

/** تنفيذ SQL واحدة (مع params) وإرجاع الصفوف — متزامن. */
export function syncQuery(
  sql: string,
  params: unknown[] = [],
  dsn = process.env.DATABASE_URL ?? "",
): QueryResult {
  if (!dsn) {
    throw new Error("DATABASE_URL مطلوب لوضع L27_STORE=postgres");
  }
  if (!existsSync(CHILD)) {
    throw new Error(`أبن PostgreSQL غير موجود: ${CHILD}`);
  }

  const proc = spawnSync(process.execPath, [CHILD], {
    input: JSON.stringify({ sql, params, dsn }),
    encoding: "utf-8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, L27_PG_CHILD: "1" },
  });

  if (proc.error) {
    throw new Error(`فشل تشغيل أبن PostgreSQL: ${proc.error.message}`);
  }

  const out = (proc.stdout ?? "").trim();
  const last = out.split("\n").filter(Boolean).pop();
  if (!last) {
    throw new Error(`أبن PostgreSQL بلا إخراج (stderr: ${(proc.stderr ?? "").trim()})`);
  }

  let parsed: { ok: boolean; rows?: Record<string, unknown>[]; error?: string };
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new Error(`إخراج أبن غير صالح: ${last.slice(0, 200)}`);
  }

  if (!parsed.ok) {
    throw new Error(`استعلام PostgreSQL فشل: ${parsed.error ?? "خطأ مجهول"}`);
  }
  return { rows: parsed.rows ?? [] };
}
