#!/usr/bin/env node
/**
 * check-manifest-drift.mjs — فحص استشاري: هل الـmanifest ما زال مطابقًا للكود؟
 *
 * الغرض: حماية مصدر الحقيقة الواحد من التقادم **دون** أن يتحوّل توليد الوثائق إلى
 * تبعية في الـbuild. هذا السكربت **لا يُفشل شيئًا** افتراضيًا (خروج 0 دائمًا)،
 * وهو منفصل تمامًا عن `generate-readme.mjs` الذي لا يقرأ الكود إطلاقًا.
 *
 * يتحقق من: النسخة، الأدوار، الإجراءات، مصفوفة الصلاحيات، بريد الحسابات المزروعة،
 * مسارات API، وملفات الوثائق المُشار إليها.
 *
 * الاستعمال:
 *   node scripts/check-manifest-drift.mjs            # تحذيرات فقط (خروج 0)
 *   node scripts/check-manifest-drift.mjs --strict   # تحذيرات + خروج 1 عند الانحراف
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

const warnings = [];
const passes = [];

const warn = (msg) => warnings.push(msg);
const ok = (msg) => passes.push(msg);

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

function compare(label, declared, actual) {
  const missing = declared.filter((d) => !actual.includes(d));
  const extra = actual.filter((a) => !declared.includes(a));
  if (missing.length || extra.length) {
    warn(
      `${label}: ${missing.length ? `ناقص في الكود [${missing.join(", ")}]` : ""}` +
        `${missing.length && extra.length ? " · " : ""}` +
        `${extra.length ? `غير مُعلَن في الـmanifest [${extra.join(", ")}]` : ""}`
    );
  } else {
    ok(`${label}: مطابق (${declared.length})`);
  }
}

/** يستخرج سلاسل نصية من مصفوفة/union في ملف TypeScript. */
function tsStringLiterals(source, anchorPattern) {
  const at = source.search(anchorPattern);
  if (at === -1) return null;
  const slice = source.slice(at, at + 4000);
  const block = slice.slice(slice.indexOf("= {"));
  const literals = [...slice.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return literals.length ? [...new Set(literals)] : null;
}

try {
  const manifest = JSON.parse(read("project.manifest.json"));
  const pkg = JSON.parse(read("package.json"));

  /* ---- النسخة ---- */
  if (manifest.version === pkg.version) ok(`النسخة: ${pkg.version}`);
  else warn(`النسخة: الـmanifest يقول ${manifest.version} و package.json يقول ${pkg.version}`);

  /* ---- الأدوار ---- */
  const rolesSrc = read("lib/authorization/roles.ts");
  if (rolesSrc) {
    const block = rolesSrc.slice(rolesSrc.indexOf("ROLES = ["), rolesSrc.indexOf("] as const"));
    const codeRoles = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const declaredRoles = (manifest.roles ?? []).map((r) => r.id);
    compare("الأدوار (roles.ts)", declaredRoles, codeRoles);
    const matrixKeys = Object.keys(manifest.matrix ?? {});
    if (matrixKeys.length) compare("مفاتيح مصفوفة الصلاحيات", matrixKeys, codeRoles);
  } else {
    warn("lib/authorization/roles.ts غير موجود — تخطّي فحص الأدوار");
  }

  /* ---- الإجراءات ---- */
  const policySrc = read("lib/authorization/policy.ts");
  if (policySrc) {
    const unionBlock = policySrc.slice(policySrc.indexOf("type Action ="), policySrc.indexOf("type Actor"));
    const codeActions = [...new Set([...unionBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]))];
    const declaredActions = (manifest.actions ?? []).map((a) => a.id);
    compare("الإجراءات (policy.ts Action)", declaredActions, codeActions);

    // الإجراءات المُشار إليها داخل المصفوفة التنفيذية فقط
    // (القصّ عند نهاية MATRIX حتى لا تُقرأ قاعدة الموارد داخل can())
    const matrixStart = policySrc.indexOf("const MATRIX");
    const matrixEnd = policySrc.indexOf("export function can");
    const matrixBlock = policySrc.slice(matrixStart, matrixEnd === -1 ? undefined : matrixEnd);
    const matrixActions = [...new Set([...matrixBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]))];
    const unknownInMatrix = matrixActions.filter((a) => !declaredActions.includes(a));
    if (unknownInMatrix.length) {
      warn(`إجراءات في MATRIX غير مُعلَنة في الـmanifest: [${unknownInMatrix.join(", ")}]`);
    } else {
      ok(`إجراءات MATRIX: كلها مُعلَنة (${matrixActions.length})`);
    }

    // مقارنة صفوف المصفوفة إجراءً بإجراء
    const roleBlocks = [...matrixBlock.matchAll(/^ {2}(\w+): \[([\s\S]*?)\],$/gm)];
    let rowMismatch = 0;
    for (const [, role, body] of roleBlocks) {
      const codeList = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const declaredList = manifest.matrix?.[role];
      if (!declaredList) continue;
      const same =
        codeList.length === declaredList.length && codeList.every((a) => declaredList.includes(a));
      if (!same) {
        rowMismatch += 1;
        warn(
          `صف ${role} في MATRIX يختلف عن الـmanifest: ` +
            `الكود [${codeList.length}] مقابل الـmanifest [${declaredList.length}]`
        );
      }
    }
    if (roleBlocks.length && !rowMismatch) ok(`صفوف المصفوفة: مطابقة إجراءً بإجراء (${roleBlocks.length} أدوار)`);
  } else {
    warn("lib/authorization/policy.ts غير موجود — تخطّي فحص الإجراءات");
  }

  /* ---- حسابات seed ---- */
  const seedSrc = read("lib/persistence/seed.ts");
  if (seedSrc) {
    const codeEmails = [...new Set([...seedSrc.matchAll(/"([a-z0-9._%+-]+@[a-z0-9.-]+)"/g)].map((m) => m[1]))];
    const declaredEmails = (manifest.roles ?? []).map((r) => r.account);
    compare("حسابات seed", declaredEmails, codeEmails);
  } else {
    warn("lib/persistence/seed.ts غير موجود — تخطّي فحص الحسابات");
  }

  /* ---- متغيرات البيئة ---- */
  const envDeclared = (manifest.env ?? []).map((e) => e.name);
  const codeFiles = ["lib/repositories/container.ts", "lib/auth/session.ts", "tests/smoke/smoke.mjs"];
  const codeEnv = new Set();
  for (const f of codeFiles) {
    const src = read(f);
    if (!src) continue;
    for (const m of src.matchAll(/process\.env\.([A-Z_0-9]+)/g)) codeEnv.add(m[1]);
  }
  codeEnv.delete("BASE_URL"); // متغير خاص بالـsmoke فقط
  const envExtra = [...codeEnv].filter((e) => !envDeclared.includes(e));
  const envMissing = envDeclared.filter((e) => !codeEnv.has(e));
  if (envExtra.length || envMissing.length) {
    warn(
      `المتغيرات البيئية: ${envMissing.length ? `مُعلَنة بلا استخدام [${envMissing.join(", ")}]` : ""}` +
        `${envMissing.length && envExtra.length ? " · " : ""}${envExtra.length ? `مستخدمة وغير مُعلَنة [${envExtra.join(", ")}]` : ""}`
    );
  } else {
    ok(`المتغيرات البيئية: مطابقة (${envDeclared.length})`);
  }

  /* ---- مسارات API ---- */
  const apiDir = join(ROOT, "app", "api");
  if (existsSync(apiDir)) {
    const routes = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "route.ts") {
          const rel = "/" + relative(join(ROOT, "app"), dir).split(/[\\/]/).join("/");
          routes.push(rel.replace(/\[id\]/g, ":id"));
        }
      }
    })(apiDir);
    const declaredPaths = [...new Set((manifest.api ?? []).map((e) => e.path.replace(/:[a-z_]+/g, ":id")))];
    const codePaths = [...new Set(routes)];
    const undocumented = codePaths.filter((p) => !declaredPaths.includes(p));
    const phantom = declaredPaths.filter((p) => !codePaths.includes(p));
    if (undocumented.length || phantom.length) {
      warn(
        `مسارات API: ${phantom.length ? `في الـmanifest بلا ملف [${phantom.join(", ")}]` : ""}` +
          `${phantom.length && undocumented.length ? " · " : ""}` +
          `${undocumented.length ? `موجودة وغير موثّقة [${undocumented.join(", ")}]` : ""}`
      );
    } else {
      ok(`مسارات API: مطابقة (${codePaths.length} مسارًا)`);
    }
  }

  /* ---- ملفات الوثائق ---- */
  const missingDocs = (manifest.docs ?? []).filter((d) => !existsSync(join(ROOT, d.path))).map((d) => d.path);
  if (missingDocs.length) warn(`ملفات وثائق مُشار إليها وغير موجودة: [${missingDocs.join(", ")}]`);
  else ok(`ملفات الوثائق: موجودة (${(manifest.docs ?? []).length})`);

  /* ---- المخرجات المُولَّدة موجودة؟ ---- */
  const missingTargets = (manifest.generated?.targets ?? []).filter((t) => !existsSync(join(ROOT, t)));
  if (missingTargets.length) warn(`مخرجات README المُولَّدة مفقودة: [${missingTargets.join(", ")}]`);
  else ok(`مخرجات README: موجودة (${(manifest.generated?.targets ?? []).length})`);
} catch (err) {
  warn(`تعذّر إكمال الفحص: ${err.message}`);
}

/* ------------------------------------------------------------ report */

console.log("\nفحص انحراف الـmanifest مقابل الكود (استشاري):\n");
for (const p of passes) console.log(`  ✅ ${p}`);
for (const w of warnings) console.log(`  ⚠️  ${w}`);

if (warnings.length) {
  console.log(
    `\n⚠️  ${warnings.length} ملاحظة انحراف — راجع project.manifest.json.\n` +
      `   هذا فحص استشاري: لا يُفشل الـbuild ولا الاختبارات.\n`
  );
  process.exit(STRICT ? 1 : 0);
}

console.log("\n✅ لا انحراف: الـmanifest مطابق للكود.\n");
