/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // أبن استعلام PostgreSQL وحزمة `pg` يجب أن تصل مع حزم الدوال على Vercel —
  // الأبن يُستدعى بمسار ديناميكي (spawnSync) فلا يراه تتبّع الملفات الآلي (VS5/T1).
  outputFileTracingIncludes: {
    "*": ["./lib/persistence/pg-child.mjs", "./node_modules/pg/**/*"],
  },
};

export default nextConfig;
