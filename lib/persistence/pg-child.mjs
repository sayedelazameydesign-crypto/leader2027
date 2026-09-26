#!/usr/bin/env node
/**
 * أبن PostgreSQL — استعلام واحد ثم خروج (VS5/T1).
 * يقرأ JSON من stdin: { sql, params, dsn } · يطبع JSON إلى stdout: { ok, rows | error }.
 * الوالد: lib/persistence/sync-pg.ts (spawnSync).
 */
import { Client } from "pg";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf-8");

let cmd;
try {
  cmd = JSON.parse(raw);
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: "JSON غير صالح" }));
  process.exit(0);
}

const client = new Client({ connectionString: cmd.dsn });
try {
  await client.connect();
  const res = await client.query(cmd.sql, Array.isArray(cmd.params) ? cmd.params : []);
  process.stdout.write(JSON.stringify({ ok: true, rows: res.rows }));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
} finally {
  await client.end().catch(() => {});
  process.exit(0);
}
