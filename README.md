# Leader 2027

منصة تشغيل وإدارة للحملة الانتخابية: أشخاص (وعي بالمصدر)، متطوعون، عمل ميداني،
تقارير، مؤشرات تشغيلية — في لوحة قيادة واحدة. **بلا أي تفضيلات سياسية** (عقد المنتج §5).

**الحالة:** VS2 مُنفَّذة — People + Volunteer + Field Report عبر طبقات Domain → Repository → Persistence.

## التشغيل

```bash
npm install
npm run dev        # تطوير على http://localhost:3000
npm run build      # بناء إنتاجي
npm start          # إنتاج على 0.0.0.0:3000
npm test           # 84+ unit/integration
npm run smoke      # إثبات production ضد خادم قائم (BASE_URL اختياري)
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

## البنية

```text
app/(app)/    لوحة قيادة، أشخاص، متطوعون، تقارير ميدانية (خلف حدود المصادقة)
app/login/    الدخول
app/api/      people / volunteers / field/reports / stats / auth — فوق domain services
lib/domain/   قواعد الكيانات + services (business logic خارج الـroute handlers)
lib/repositories/  واجهات المخزن (Domain → Repository Interface → Persistence Adapter)
lib/persistence/   InMemory + FileJson (var/data/db.json) — PostgreSQL لاحقاً بلا إعادة كتابة domain
lib/auth+authorization+audit+validation   جلسات HMAC، مصفوفة 6 أدوار، تدقيق لكل mutation، رفض §5
tests/        unit + integration + smoke (يُشغَّل في CI ضد next start)
```

بيئات: `L27_STORE=memory|file` (افتراضي file)، `L27_DB_PATH`، `L27_SESSION_SECRET`.

## النشر على Vercel

جاهز (Next.js قياسي + lockfile + CI أخضر). النشر يتطلب ربط حسابك على
[vercel.com/new](https://vercel.com/new) واستيراد المستودع — أو `npx vercel`.
**تنويه:** محولّ FileJson ephemeral على serverless؛ الإنتاج المُنشر يحتاج محولّ PostgreSQL
(خارطة الطريق P1/P2) — الواجهة (`Repository Interface`) مصممة لذلك.

## المزامنة مع GitHub

آلية مثبتة عملياً: `CHANGE → COMMIT → PUSH → VERIFY_REMOTE` —
انظر [docs/sync-verification.md](docs/sync-verification.md).
