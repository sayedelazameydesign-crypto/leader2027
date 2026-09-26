#!/usr/bin/env node
/**
 * generate-readme.mjs — يولّد README.md (عربي) و README.en.md من project.manifest.json
 *
 * القاعدة المعمارية:
 *   - README ملف **ناتج مشتق** (Derived Artifact) — لا يُعدَّل يدويًا ولا يدخل في الـbuild.
 *   - لا يقرأ هذا السكربت ملفات الكود لاستنتاج حالة النظام: الـmanifest هو مصدر الحقيقة.
 *   - الاستثناء الوحيد: package.json (نسخة/سكربتات/اعتماديات) — مصدر معلومات المشروع.
 *   - المخرجات **حتمية** بلا طوابع زمنية، حتى يعمل `--check` ككاشف انحراف موثوق.
 *
 * الاستعمال:
 *   node scripts/generate-readme.mjs              # توليد (فشل = خروج 1)
 *   node scripts/generate-readme.mjs --warn-only  # توليد (فشل = تحذير فقط، خروج 0)
 *   node scripts/generate-readme.mjs --check      # كشف الانحراف دون كتابة
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "project.manifest.json");
const PKG_PATH = join(ROOT, "package.json");

const argv = process.argv.slice(2);
const WARN_ONLY = argv.includes("--warn-only");
const CHECK_ONLY = argv.includes("--check");

/* ------------------------------------------------------------------ utils */

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`ملف مفقود: ${label} (${path})`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`JSON غير صالح في ${label}: ${err.message}`);
  }
}

function require_(value, field) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`حقل مطلوب مفقود في الـmanifest: ${field}`);
  }
  return value;
}

/** يستخرج نصًا بلغة محددة من كائن { ar, en } أو يعيد القيمة كما هي. */
function t(value, lang) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  const out = value[lang] ?? value.ar ?? value.en;
  if (out === undefined) throw new Error(`قيمة بلا ترجمة للغة "${lang}": ${JSON.stringify(value)}`);
  return out;
}

/** قائمة نقطية بلغة محددة. */
function bullets(list, lang, indent = "") {
  return (list ?? []).map((item) => `${indent}- ${t(item, lang)}`).join("\n");
}

/** يهرّب الأنابيب حتى لا تكسر بنية جدول Markdown. */
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|");

/** جدول Markdown من صفوف وعناوين. */
function table(headers, rows) {
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

const MARK = { yes: "✅", no: "—" };

/* ------------------------------------------------------- builder (per lang) */

function build(manifest, pkg, lang) {
  const isAr = lang === "ar";
  const L = isAr ? "ar" : "en";
  const other = isAr ? "en" : "ar";
  const otherFile = isAr ? "README.en.md" : "README.md";
  const otherLabel = isAr ? "English" : "العربية";

  const name = require_(manifest.name, "name");
  const repo = manifest.repository;
  const out = [];

  /* ---------------- banner ---------------- */
  out.push(
    `<!-- ⚠️ ${isAr ? "ملف مُولَّد آليًا — لا تُعدّله يدويًا" : "GENERATED FILE — do not edit by hand"} -->`,
    `<!-- ${isAr ? "المصدر" : "Source"}: project.manifest.json · ${isAr ? "المولّد" : "Generator"}: ${manifest.generated.generator} -->`,
    ""
  );

  /* ---------------- header ---------------- */
  const badges = [];
  badges.push(`**v${pkg.version}**`);
  if (manifest.license) badges.push(`**${manifest.license}**`);
  if (manifest.node) badges.push(`**Node ${manifest.node}+**`);
  out.push(
    `# ${name}`,
    "",
    `> ${t(manifest.description, L)}`,
    "",
    badges.join(" · ") + ` · [${otherLabel}](${otherFile})`,
    ""
  );

  /* ---------------- status ---------------- */
  out.push(
    isAr ? "## الحالة" : "## Status",
    "",
    `**${manifest.status.phase}** — ${t(manifest.status, L)}`,
    ""
  );
  if (manifest.milestones?.length) {
    out.push(
      table(
        [isAr ? "الشريحة" : "Slice", isAr ? "الوصف" : "Description", isAr ? "الحالة" : "State", isAr ? "الدليل" : "Evidence"],
        manifest.milestones.map((m) => [
          `**${m.id}**`,
          t(m.name, L),
          { merged: isAr ? "مدموج" : "Merged", implemented: isAr ? "منفَّذ" : "Implemented", planned: isAr ? "مخطَّط" : "Planned" }[m.state] ?? m.state,
          m.evidence ? `\`${m.evidence}\`` : "—",
        ])
      ),
      ""
    );
  }

  /* ---------------- principles ---------------- */
  if (manifest.principles?.[L]?.length) {
    out.push(isAr ? "## المبادئ الملزمة" : "## Binding Principles", "", bullets(manifest.principles[L], L), "");
  }

  /* ---------------- commands ---------------- */
  if (manifest.scriptNotes) {
    // الأوامر تأتي من package.json (مصدر معلومات المشروع)، والشرح من الـmanifest.
    const cmdRows = Object.keys(pkg.scripts ?? {})
      .filter((key) => !(manifest.skipScripts ?? []).includes(key))
      .map((key) => {
        const cmd = `npm run ${key}`;
        const note = manifest.scriptNotes[key];
        return [`\`${cmd}\``, note ? t(note, L) : "—"];
      });

    if (cmdRows.length) {
      out.push(isAr ? "## التشغيل" : "## Running", "", "```bash", "npm ci", "```", "");
      out.push(table([isAr ? "الأمر" : "Command", isAr ? "الوصف" : "Description"], cmdRows), "");
    }
  }

  /* ---------------- accounts ---------------- */
  if (manifest.roles?.length) {
    out.push(
      isAr ? "## حسابات تشغيلية تجريبية (seed-only)" : "## Demo Operations Accounts (seed-only)",
      "",
      table(
        [isAr ? "البريد" : "Email", isAr ? "الدور" : "Role", isAr ? "المستوى" : "Level"],
        manifest.roles.map((r) => [`\`${r.account}\``, `${r.label ? t(r.label, L) + " — " : ""}\`${r.id}\``, manifest.levels?.[r.level] ? t(manifest.levels[r.level], L) : r.level ?? "—"])
      ),
      "",
      t(manifest.accountsNote, L),
      ""
    );
  }

  /* ---------------- permission matrix ---------------- */
  if (manifest.matrix && manifest.actions?.length) {
    const roles = manifest.roles?.length ? manifest.roles.map((r) => r.id) : Object.keys(manifest.matrix);
    out.push(
      isAr ? "## مصفوفة الصلاحيات" : "## Permission Matrix",
      "",
      table(
        [isAr ? "الإجراء" : "Action", ...roles.map((r) => `\`${r}\``)],
        manifest.actions.map((a) => [
          `${t(a.label, L)} — \`${a.id}\``,
          ...roles.map((r) => ((manifest.matrix[r] ?? []).includes(a.id) ? MARK.yes : MARK.no)),
        ])
      ),
      ""
    );
    if (manifest.sessionRules?.[L]?.length) {
      out.push(isAr ? "### قواعد الجلسة" : "### Session Rules", "", bullets(manifest.sessionRules[L], L), "");
    }
  }

  /* ---------------- api ---------------- */
  if (manifest.api?.length) {
    out.push(
      isAr ? "## واجهات API" : "## API",
      "",
      table(
        [isAr ? "الطريقة" : "Method", isAr ? "المسار" : "Path", isAr ? "ملاحظة" : "Note"],
        manifest.api.map((e) => [`\`${e.method}\``, `\`${e.path}\``, t(e.note, L)])
      ),
      "",
      isAr ? "كل mutation ينشئ AuditEvent · `password_hash` لا يظهر في أي استجابة." : "Every mutation writes an AuditEvent · `password_hash` never appears in any response.",
      ""
    );
  }

  /* ---------------- screens ---------------- */
  if (manifest.screens?.[L]?.length) {
    out.push(isAr ? "## الشاشات" : "## Screens", "", bullets(manifest.screens[L], L), "");
  }

  /* ---------------- structure ---------------- */
  if (manifest.structure?.length) {
    const tree = [
      "app/          " + (isAr ? "الصفحات + API + globals.css + layout" : "Pages + API + globals.css + layout"),
      "components/   " + (isAr ? "admin / dashboard / field / people / volunteers / ui" : "admin / dashboard / field / people / volunteers / ui"),
      "lib/          " + (isAr ? "domain / repositories / persistence / auth / authorization / audit / validation" : "domain / repositories / persistence / auth / authorization / audit / validation"),
      "scripts/      " + (isAr ? "توليد الوثائق + فحص الانحراف" : "Doc generation + drift check"),
      "docs/         " + (isAr ? "العقود والخطط وسجل المزامنة" : "Contracts, plans, sync record"),
      "tests/        " + (isAr ? "unit / integration / smoke" : "unit / integration / smoke"),
    ].join("\n");
    out.push(
      isAr ? "## البنية" : "## Structure",
      "",
      "```text",
      tree,
      "```",
      "",
      table([isAr ? "المسار" : "Path", isAr ? "المحتوى" : "Contents"], manifest.structure.map((s) => [`\`${s.path}\``, t(s.note, L)])),
      ""
    );
  }

  /* ---------------- environment ---------------- */
  if (manifest.env?.length) {
    out.push(
      isAr ? "## المتغيرات البيئية" : "## Environment Variables",
      "",
      table(
        [isAr ? "المتغير" : "Variable", isAr ? "القيم" : "Values", isAr ? "الافتراضي" : "Default", isAr ? "ملاحظة" : "Note"],
        manifest.env.map((e) => [`\`${e.name}\``, e.values ?? "—", `\`${e.default}\``, t(e.note, L)])
      ),
      ""
    );
  }

  /* ---------------- gates ---------------- */
  if (manifest.gates?.length) {
    out.push(
      isAr ? "## بوابات الجودة" : "## Quality Gates",
      "",
      table(
        [isAr ? "البوابة" : "Gate", isAr ? "الأمر" : "Command", isAr ? "المتوقع" : "Expected"],
        manifest.gates.map((g) => [`\`${g.id}\``, `\`${g.script}\``, `**${g.expected}**`])
      ),
      "",
      isAr
        ? "CI يشغّل هذه البوابات كلها على كل push/PR — انظر [`.github/workflows/ci.yml`](.github/workflows/ci.yml)."
        : "CI runs all of these on every push/PR — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).",
      ""
    );
  }

  /* ---------------- deploy ---------------- */
  if (manifest.deploy?.[L]?.length) {
    out.push(isAr ? "## النشر على Vercel" : "## Deploying to Vercel", "", bullets(manifest.deploy[L], L), "");
  }

  /* ---------------- sync ---------------- */
  if (manifest.syncRules?.[L]?.length) {
    out.push(
      isAr ? "## المزامنة مع GitHub" : "## GitHub Sync",
      "",
      `[\`docs/sync-verification.md\`](docs/sync-verification.md)`,
      "",
      bullets(manifest.syncRules[L], L),
      ""
    );
  }

  /* ---------------- docs index ---------------- */
  if (manifest.docs?.length) {
    out.push(
      isAr ? "## الوثائق" : "## Documentation",
      "",
      table([isAr ? "الملف" : "File", isAr ? "المحتوى" : "Contents"], manifest.docs.map((d) => [`[\`${d.path}\`](${d.path})`, t(d.label, L)])),
      ""
    );
  }

  /* ---------------- out of scope ---------------- */
  if (manifest.outOfScope?.[L]?.length) {
    out.push(
      isAr ? "## خارج النطاق (صراحة)" : "## Explicitly Out of Scope",
      "",
      bullets(manifest.outOfScope[L].map((x) => `❌ ${x}`), L),
      ""
    );
  }

  /* ---------------- generation contract ---------------- */
  out.push(
    isAr ? "## كيف يُولَّد هذا الملف" : "## How This File Is Generated",
    "",
    isAr
      ? [
          "هذا الـREADME **ناتج مشتق (Derived Artifact)** لا يُعدَّل يدويًا:",
          "",
          "```text",
          "project.manifest.json  (مصدر الحقيقة الوحيد)",
          "        │",
          "        ├── npm run readme:generate  →  README.md + README.en.md",
          "        ├── npm run readme:check     →  كشف الانحراف عن الـmanifest",
          "        └── npm run readme:drift     →  فحص استشاري: الـmanifest مقابل الكود",
          "```",
          "",
          "```bash",
          "npm run readme:generate   # عدّل الـmanifest ثم ولّد",
          "npm run readme:check      # يفشل إن كان الـREADME قديمًا",
          "```",
          "**مستقل عن الـbuild:** فشل توليد الـREADME **لا يفشل** بناء النظام ولا اختباراته —",
          "في CI يعمل التوليد كخطوة استشارية (`continue-on-error`) تُصدِر تحذيرًا فقط.",
        ].join("\n")
      : [
          "This README is a **derived artifact** and is never edited by hand:",
          "",
          "```text",
          "project.manifest.json  (single source of truth)",
          "        │",
          "        ├── npm run readme:generate  →  README.md + README.en.md",
          "        ├── npm run readme:check     →  drift detection vs the manifest",
          "        └── npm run readme:drift     →  advisory check: manifest vs code",
          "```",
          "",
          "```bash",
          "npm run readme:generate   # edit the manifest, then generate",
          "npm run readme:check      # fails if the README is stale",
          "```",
          "**Decoupled from the build:** a README generation failure **never fails** the system build or its tests —",
          "in CI generation runs as an advisory step (`continue-on-error`) that emits a warning only.",
        ].join("\n"),
    ""
  );

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* ---------------------------------------------------------------- main */

function main() {
  const manifest = readJson(MANIFEST_PATH, "project.manifest.json");
  const pkg = readJson(PKG_PATH, "package.json");

  require_(manifest.generated, "generated");
  require_(manifest.generated.generator, "generated.generator");
  require_(manifest.status, "status");

  const targets = manifest.generated.targets ?? ["README.md"];
  const results = [];
  for (const target of targets) {
    const lang = target.toLowerCase().includes(".en.") ? "en" : "ar";
    const content = build(manifest, pkg, lang);
    const path = join(ROOT, target);

    if (CHECK_ONLY) {
      const current = existsSync(path) ? readFileSync(path, "utf8") : null;
      const same = current === content;
      results.push({ target, same, reason: current === null ? "missing" : "stale" });
      console.log(
        `${same ? "OK  " : "DRIFT"}  ${target}${same ? "" : `  (${current === null ? "ملف مفقود" : "محتوى مختلف عن الـmanifest"})`}`
      );
    } else {
      writeFileSync(path, content, "utf8");
      results.push({ target, same: true, bytes: Buffer.byteLength(content, "utf8") });
      console.log(`WROTE  ${target}  (${Buffer.byteLength(content, "utf8")} bytes)`);
    }
  }

  if (CHECK_ONLY) {
    const drifted = results.filter((r) => !r.same);
    if (drifted.length) {
      console.warn(
        `\n⚠️  ${drifted.length} من ${results.length} ملفات README غير متزامنة مع project.manifest.json.\n` +
          `   شغّل: npm run readme:generate\n` +
          `   (هذا تحذير استشاري — لا يُفشل الـbuild.)`
      );
      process.exit(WARN_ONLY ? 0 : 1);
    }
    console.log("\n✅ README متزامن مع project.manifest.json");
    return;
  }

  console.log(`\n✅ ${results.length} ملف README مُولَّد من project.manifest.json`);
}

try {
  main();
} catch (err) {
  if (WARN_ONLY) {
    // لا يُفشل الـbuild أبدًا — انظر مخطط التدفق في docs/readme-generation.md
    console.warn(`\n⚠️  تخطّي توليد README (تحذير فقط، الـbuild غير متأثر): ${err.message}\n`);
    process.exit(0);
  }
  console.error(`\n❌ فشل توليد README: ${err.message}\n`);
  process.exit(1);
}
