/**
 * P2 — قواعد الإقلاع (fail-closed). ESM خام (بلا TypeScript) لأن `next.config.mjs`
 * يُحمَّل في node مباشرة قبل أي بناء — فيجب أن يبقى بلا اعتمادات ولا تجميع.
 *
 * المصدر الوحيد لقاعدة سرّ الجلسات: `sessionSecretIssue` هنا، وتستورده
 * `lib/auth/session.ts` (عند أول استخدام) و`next.config.mjs` (عند الإقلاع).
 *
 * لماذا بوابة إقلاع لا رفض عند الطلب وحده؟
 * رفض lazy = خادم يُقلع ويخدم صفحات ثم يرمي 500 عند أول جلسة ⇒ فشل جزئي غامض.
 * المطلوب: **لا يُقلع أصلاً** بلا سرّ صالح على الإنتاج، برسالة إصلاح واضحة.
 */

export const DEV_SESSION_SECRET = "l27-dev-secret-change-me";
export const MIN_SECRET_LENGTH = 16;

/** missing | too_short | dev_secret | null (صالح) */
export function sessionSecretIssue(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return "missing";
  if (raw.trim().length < MIN_SECRET_LENGTH) return "too_short";
  if (raw === DEV_SESSION_SECRET) return "dev_secret";
  return null;
}

export function sessionSecretMessage(issue) {
  const base = "رفض الإقلاع (fail-closed): ";
  if (issue === "missing") {
    return `${base}L27_SESSION_SECRET غير معرّف — لا يمكن توقيع الجلسات على الإنتاج. عرّفه (≥ ${MIN_SECRET_LENGTH} حرفاً) وأعد التشغيل. انظر .env.example`;
  }
  if (issue === "too_short") {
    return `${base}L27_SESSION_SECRET أقصر من ${MIN_SECRET_LENGTH} حرفاً — سرّ ضعيف. ولّد سراً عشوائياً طويلاً وأعد التشغيل.`;
  }
  return `${base}L27_SESSION_SECRET مساوٍ لسرّ التطوير المنشور في المستودع — مكشوف للجميع. غيّره على الإنتاج.`;
}

/**
 * دالة نقية (تُختبر بلا process.env): production ← سرّ صريح صالح أو رفض.
 * غير production ← سرّ التطوير (تطوير/اختبارات بلا انحدار).
 */
export function resolveSessionSecret(nodeEnv, raw) {
  if (nodeEnv === "production") {
    const issue = sessionSecretIssue(raw);
    if (issue) throw new Error(sessionSecretMessage(issue));
    return raw.trim();
  }
  return DEV_SESSION_SECRET;
}

/**
 * بوابة الإقلاع — نقية: تُطبق فقط على `next start` (الإنتاج).
 * `next build` مستثنى صراحةً حتى لا يُجبر أحد على وضع سرّ في بيئة البناء
 * (السرّ لازم وقت التشغيل لا وقت التجميع)، و`next dev` يعمل بسرّ التطوير.
 */
export function assertRuntimeConfig({ isStart, nodeEnv, raw }) {
  if (!isStart) return null;
  return resolveSessionSecret(nodeEnv, raw);
}

/**
 * استنتاج أمر الإقلاع من حقيقة العملية — لا من `next start` كنص واحد في argv.
 *
 * مُثبت بالقياس (Next 16.3.6): عند `npm start` تُحمَّل next.config.mjs مرة واحدة في
 * عملية الخادم نفسها — `process.argv = [node, .../.bin/next, "start", ...]` و
 * `process.title = "next-server (vX)"` و`npm_lifecycle_script = "next start ..."`.
 * (الفحص الساذج `arg.includes("next start")` لا يطابق شيئاً ⇒ خادم يُقلع رغم الرفض
 * المطلوب — وهو ما صححه هذا الاستنتاج الثلاثي.)
 *
 * عند `next build`: `argv = [node, .../.bin/next, "build"]` (+ عمال jest-worker
 * بـargv مختلف تماماً) و`npm_lifecycle_event = "build"` ⇒ البوابة لا تُطبق.
 */
export function detectBootCommand({ argv, title, env }) {
  const args = Array.isArray(argv) ? argv.filter((a) => typeof a === "string") : [];
  const script = typeof env?.npm_lifecycle_script === "string" ? env.npm_lifecycle_script : "";
  const lifecycle = typeof env?.npm_lifecycle_event === "string" ? env.npm_lifecycle_event : "";

  const isBuild = args.includes("build") || /\bnext\s+build\b/.test(script) || lifecycle === "build";
  if (isBuild) return "build";

  const isStart =
    args.includes("start") ||
    /\bnext\s+start\b/.test(script) ||
    lifecycle === "start" ||
    (typeof title === "string" && title.includes("next-server"));
  if (isStart) return "start";

  const isDev = args.includes("dev") || /\bnext\s+dev\b/.test(script) || lifecycle === "dev";
  if (isDev) return "dev";

  return "unknown";
}

/** يقرأ حقيقة العملية الحالية (argv + title + env) ويطبق القاعدة. */
export function assertBootEnvironment(
  argv = process.argv,
  env = process.env,
  title = process.title,
) {
  return assertRuntimeConfig({
    isStart: detectBootCommand({ argv, title, env }) === "start",
    nodeEnv: env?.NODE_ENV,
    raw: env?.L27_SESSION_SECRET,
  });
}
