# Leader 2027

منصة تشغيل وإدارة للحملة الانتخابية: أشخاص (وعي بالمصدر)، متطوعون، عمل ميداني،
تقارير، مؤشرات تشغيلية — في لوحة قيادة واحدة. **بلا أي تفضيلات سياسية** (عقد المنتج §5).

**الحالة:** VS1+VS2 = **MERGED في main (PR #1 — `ae977e4`)** · VS3 (نواة الحملة الإدارية) = **منفَّذ — بوابات محلية خضراء**
(typecheck ✅ · 98/98 ✅ · build ✅ · smoke 31/31 ✅) — عقدها المُقفَّل `docs/contract-vs3.md` وخطة `docs/plan-vs3.md`.

## التشغيل

```bash
npm install
npm run dev        # تطوير على http://localhost:3000
npm run build      # بناء إنتاجي
npm start          # إنتاج على 0.0.0.0:3000
npm test           # 98 unit/integration
npm run smoke      # 31 فحص production ضد خادم قائم (BASE_URL اختياري)
npm run typecheck
```

## حسابات تشغيلية تجريبية (seed-only)

| البريد | الدور |
| --- | --- |
| owner@leader2027.test | OWNER |
| admin@leader2027.test | CAMPAIGN_ADMIN |
| manager@leader2027.test | CAMPAIGN_MANAGER |
| coordinator@leader2027.test | FIELD_COORDINATOR |
| worker@leader2027.test | FIELD_WORKER |
| viewer@leader2027.test | VIEWER |

كلمة المرور للكل: `Demo!2345` — بيانات تشغيلية فقط وليست إنتاجية.

الصلاحيات: `settings:manage` (الحملة/الدورات/المناطق/الفرق) = OWNER/CAMPAIGN_ADMIN/CAMPAIGN_MANAGER ·
`users:manage` = Manager+. تغيير الدور يُسقط الجلسات القديمة (session_epoch)؛ البريد وكلمة المرور غير قابلين للتعديل في v1.

## البنية

```text
app/(app)/    لوحة قيادة، أشخاص، متطوعون، تقارير، إدارة (/admin + /admin/users) — خلف حدود المصادقة
app/login/    الدخول
app/api/      people / volunteers / field/reports / stats / auth / campaign / cycles / regions / teams / users
lib/domain/   قواعد الكيانات + services — people/volunteers/field/stats/dashboard/settings/users
lib/repositories/  واجهات المخزن (Domain → Repository Interface → Persistence Adapter)
lib/persistence/   InMemory + FileJson (var/data/db.json) — PostgreSQL لاحقاً بلا إعادة كتابة domain
lib/auth+authorization+audit+validation   جلسات HMAC (session_epoch)، مصفوفة 6 أدوار + settings:manage، تدقيق لكل mutation، رفض §5
tests/        unit + integration + smoke (يُشغَّل في CI ضد next start)
```

بيئات: `L27_STORE=memory|file` (افتراضي file)، `L27_DB_PATH`، `L27_SESSION_SECRET`.

## النشر على Vercel

جاهز (Next.js قياسي + lockfile + CI أخضر). النشر يتطلب ربط حسابك على
[vercel.com/new](https://vercel.com/new) واستيراد المستودع — أو `npx vercel`.
**تنويه مُثبَّت:** القرص ephemeral على Vercel serverless — محولّ PostgreSQL لاحقاً فوق نفس
الواجهة (`Repository Interface`) بلا إعادة كتابة domain (TODO موثّق في `lib/persistence/file-json.ts`).

## المزامنة مع GitHub

آلية مثبتة عملياً: `CHANGE → COMMIT → PUSH → VERIFY_REMOTE` —
انظر [docs/sync-verification.md](docs/sync-verification.md).

قواعد ملزمة: لا commit قبل تغيير مقصود + بوابات خضراء · الدمج بإثبات `mergedAt ≠ null` ·
النشر = **DEPLOYED = VERIFIED** فقط بعد اختبار الـURL الحي فعلياً.
