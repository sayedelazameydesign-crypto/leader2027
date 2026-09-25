import { assertBootEnvironment } from "./lib/runtime/config.mjs";

/**
 * P2 — بوابة الإقلاع fail-closed (تُنفَّذ عند تحميل الإعداد، أي في `next build`
 * و`next start` و`next dev`). القاعدة نفسها نقية ومُختبَرة في `lib/runtime/config.mjs`:
 * تُطبق على `next start` فقط، وعلى NODE_ENV=production فقط.
 *
 * النتيجة المُثبتة في CI: `next start` بلا `L27_SESSION_SECRET` صالح ← خروج ≠ 0
 * ورسالة «رفض الإقلاع (fail-closed): …» — الخادم لا يقلع بثغرة تزوير الجلسات.
 */
assertBootEnvironment();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
