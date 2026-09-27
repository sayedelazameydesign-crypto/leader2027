/**
 * T4 — دليل الإنتاج (READ ONLY) — بوابة ما قبل الإطلاق.
 *
 *   node scripts/t4-prod-evidence.mjs
 *
 * يجمع دليلين مستقلّين + مؤشرًا إعلاميًا، ثم يحكم على البوابة:
 *   NEON   : عدّ حسابات العرض (`%@leader2027.test`) داخل `l27_store` — في معاملة
 *            READ ONLY مُثبتة (`transaction_read_only=on` يُطبع كجزء من الدليل).
 *            **لا كتابة إطلاقًا** — DATABASE MUTATION = DENIED.
 *   VERCEL : حالة `L27_SEED_DEMO_ACCOUNTS` في بيئة Production (عبر REST API):
 *            absent ≡ معطّل في الإنتاج (finalize يحذفه بالتصميم) · "0" ≡ معطّل · "1" = FAIL.
 *   LIVE   : (إعلامي) رموز حالة `/api/health` و`/api/debug/headers` (404 = مُطفأ بعد finalize).
 *
 * الأسرار تُقرأ من البيئة فقط ولا تُطبع أبدًا: لا DSN، لا token، لا بريد، لا hash —
 * أرقام وأعلام وأسماء متغيرات فقط. رسائل الأخطاء تُختزل إلى code/name (لا نصوص حرّة).
 * كل سطر إخراج ASCII (تعليقات GitHub تُسقط غير ASCII بصمت — درس t4-verify).
 *
 * الخروج: 0 فقط إذا NEON=PASS و VERCEL=PASS (demo_user_count=0 والبذر معطّل)؛ وإلا 1.
 */
import { writeFileSync } from "node:fs";

const OUT = process.env.L27_EVIDENCE_OUT ?? "";
const lines = [];
function say(section, text) {
  const line = `${section}: ${text}`.replace(/[^\x20-\x7E]/g, "?").slice(0, 600);
  lines.push(line);
  console.log(`::notice title=${section}::${line}`);
}

const SEED_IDS = ["user-owner", "user-admin", "user-manager", "user-coordinator", "user-worker", "user-viewer"];

// الاستعلام المعتمد للتدقيق (ILIKE — تحفّظًا لبيانات أُدخلت خارج مسار التطبيق).
const COUNT_SQL = `
SELECT
  COUNT(*) AS demo_user_count
FROM l27_store s,
     jsonb_array_elements(COALESCE(s.doc->'users', '[]'::jsonb)) AS u
WHERE s.id = 'default'
  AND (u->>'email') ILIKE '%@leader2027.test'`;

// سياق مساعد — تجميعات فقط (لا صفوف فردية، لا بريد، لا معرّفات مطبوعة).
const CONTEXT_SQL = `
WITH s AS (SELECT doc, version, updated_at FROM l27_store WHERE id = 'default'),
     u AS (SELECT u FROM s, jsonb_array_elements(COALESCE(s.doc->'users', '[]'::jsonb)) AS u)
SELECT
  (SELECT count(*) FROM s)                                                        AS store_rows,
  (SELECT version FROM s)                                                         AS store_version,
  (SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM s) AS store_updated_at,
  (SELECT count(*) FROM u)                                                        AS users_total,
  (SELECT count(*) FROM u WHERE (u->>'email') LIKE '%@leader2027.test')           AS demo_like,
  (SELECT count(*) FROM u WHERE (u->>'email') ILIKE '%@leader2027.test'
                            AND (u->>'id') = ANY($1::text[]))                     AS demo_seed_ids`;

async function neon() {
  const dsn = process.env.DATABASE_URL_CHECK_ONLY ?? "";
  if (!dsn) {
    say("NEON", "BLOCKED secret=DATABASE_URL_CHECK_ONLY status=absent (add it in GitHub > Settings > Secrets > Actions; never via chat)");
    return { verdict: "BLOCKED" };
  }
  say("NEON", `pooler=${dsn.includes("-pooler") ? "yes" : "no"} sslmode=${/sslmode=/.test(dsn) ? "set" : "unset"}`);

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: dsn,
    application_name: "l27-t4-prod-evidence-readonly",
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
  });
  try {
    await client.connect();
    // READ ONLY على مستويي الجلسة والمعاملة — أي كتابة ترفضها Postgres نفسها.
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await client.query("BEGIN READ ONLY");
    const ro = (await client.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0].ro;
    say("NEON", `transaction_read_only=${ro}`);
    if (ro !== "on") {
      await client.query("ROLLBACK");
      say("NEON", "ABORT read-only guard not active — no query executed");
      return { verdict: "ERROR" };
    }

    const count = Number((await client.query(COUNT_SQL)).rows[0].demo_user_count);
    const c = (await client.query(CONTEXT_SQL, [SEED_IDS])).rows[0];
    await client.query("ROLLBACK");

    say("NEON", `demo_user_count=${count}`);
    say(
      "NEON",
      `store_rows=${c.store_rows} store_version=${c.store_version ?? "n/a"} store_updated_at=${c.store_updated_at ?? "n/a"} users_total=${c.users_total}`,
    );
    say("NEON", `demo_like=${c.demo_like} demo_seed_ids=${c.demo_seed_ids} demo_other=${count - Number(c.demo_seed_ids)}`);
    const verdict = count === 0 ? "PASS" : "FAIL";
    say("NEON", `verdict=${verdict} (gate requires demo_user_count=0; removal is a separate, authorized step)`);
    return { verdict, count };
  } catch (err) {
    // لا رسائل حرّة: قد تحمل أسماء أدوار/مضيفين. code/name فقط.
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "n/a";
    const name = err instanceof Error ? err.name : "Error";
    say("NEON", `ERROR code=${code} name=${name} (no details printed by design)`);
    return { verdict: "ERROR" };
  } finally {
    await client.end().catch(() => {});
  }
}

async function vercel() {
  const token = process.env.VERCEL_TOKEN ?? "";
  if (!token) {
    say("VERCEL", "BLOCKED secret=VERCEL_TOKEN status=absent (or run locally: npx vercel env ls production)");
    return { verdict: "BLOCKED" };
  }
  const project = process.env.VERCEL_PROJECT || "leader2027";
  const slug = process.env.VERCEL_TEAM_SLUG || "celia-fashions-projects";
  const attempts = [
    { label: `team:${slug}`, qs: `decrypt=true&slug=${encodeURIComponent(slug)}` },
    { label: "personal", qs: "decrypt=true" },
  ];
  let envs = null;
  for (const a of attempts) {
    const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/env?${a.qs}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      envs = (await res.json()).envs ?? [];
      say("VERCEL", `project=${project} scope=${a.label} http=${res.status}`);
      break;
    }
    say("VERCEL", `project=${project} scope=${a.label} http=${res.status}`);
  }
  if (!envs) {
    say("VERCEL", "ERROR could not read project env (check token scope / VERCEL_PROJECT / VERCEL_TEAM_SLUG vars)");
    return { verdict: "ERROR" };
  }

  const prod = envs.filter((e) => Array.isArray(e.target) && e.target.includes("production"));
  const names = prod.map((e) => e.key).filter((k) => k.startsWith("L27_")).sort();
  say("VERCEL", `production L27_* names=[${names.join(",")}]`);
  say("VERCEL", `production DATABASE_URL=${prod.some((e) => e.key === "DATABASE_URL") ? "present" : "absent"}`);

  const flag = prod.find((e) => e.key === "L27_SEED_DEMO_ACCOUNTS");
  if (!flag) {
    say("VERCEL", "L27_SEED_DEMO_ACCOUNTS=absent in production (absent == disabled: demoAccountsAllowed() is false when NODE_ENV=production)");
    say("VERCEL", "verdict=PASS");
    return { verdict: "PASS", state: "absent" };
  }
  const raw = typeof flag.value === "string" ? flag.value : "";
  const shown = /^[01]$/.test(raw) ? raw : "<redacted:non-flag>";
  say("VERCEL", `L27_SEED_DEMO_ACCOUNTS=present targets=${flag.target.join("|")} type=${flag.type} value=${shown}`);
  const verdict = raw === "0" ? "PASS" : raw === "1" ? "FAIL" : "REVIEW";
  say("VERCEL", `verdict=${verdict}`);
  return { verdict, state: shown };
}

async function live() {
  const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
  if (!base) {
    say("LIVE", "skipped (BASE_URL unset)");
    return;
  }
  for (const p of ["/api/health", "/api/debug/headers"]) {
    try {
      const res = await fetch(`${base}${p}`, { cache: "no-store", redirect: "manual" });
      let note = "";
      if (p.endsWith("headers") && res.status === 404) note = " (L27_DEBUG_HEADERS off, as after finalize)";
      if (res.status >= 300 && res.status < 400) {
        // التطبيق لا يعيد توجيه أي GET — 3xx هنا يأتي من أمام التطبيق (مثل Vercel Deployment Protection/SSO).
        let host = "n/a";
        try { host = new URL(res.headers.get("location") ?? "", base).host; } catch { /* keep n/a */ }
        note = ` location_host=${host} (app never redirects GET; 3xx = in front of the app, e.g. Vercel Deployment Protection)`;
      }
      say("LIVE", `${p} -> ${res.status}${note}`);
    } catch (err) {
      say("LIVE", `${p} -> fetch-error ${err instanceof Error ? err.name : "Error"}`);
    }
  }
}

const n = await neon();
const v = await vercel();
await live();

const pass = n.verdict === "PASS" && v.verdict === "PASS";
say("GATE", `NEON=${n.verdict} VERCEL=${v.verdict} => ${pass ? "PRE-LAUNCH EVIDENCE OK" : "PRE-LAUNCH BLOCKED"}`);

if (OUT) writeFileSync(OUT, lines.join("\n") + "\n");
process.exit(pass ? 0 : 1);
