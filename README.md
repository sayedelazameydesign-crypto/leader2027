# Leader 2027

منصة تشغيل وإدارة للحملة الانتخابية: أشخاص (وعي بالمصدر)، متطوعون، عمل ميداني،
تقارير، مؤشرات تشغيلية — في لوحة قيادة واحدة. **بلا أي تفضيلات سياسية** (عقد المنتج §5).

**الحالة:** VS1+VS2 = **MERGED في main (PR #1 — `ae977e4`)** · VS3 (نواة الحملة الإدارية) =
**MERGED في main (PR #2 — `7916b20`، `mergedAt = 2026-09-25T22:31:03Z`)** · بعدها P1+P2 (حاوية CI المعزولة +
الإقلاع fail-closed) منفَّذان على فرع العمل — الخطتان: `docs/contract-vs3.md` · `docs/plan-vs3.md` · `docs/plan-p1-p2.md`.

## التشغيل

```bash
npm install
npm run dev        # تطوير على http://localhost:3000
npm run build      # بناء إنتاجي
npm start          # إنتاج على 0.0.0.0:3000
npm test           # 130 unit/integration
npm run smoke      # 34 فحص production ضد خادم قائم (BASE_URL اختياري)
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

### بيئات

| المتغير | المعنى |
| --- | --- |
| `L27_STORE` | `file` (افتراضي) أو `memory` |
| `L27_DB_PATH` | مسار حاوية البيانات (في CI: `runner.temp` — معزولة وطازجة لكل تشغيل) |
| `L27_SESSION_SECRET` | **إلزامي على الإنتاج** (`NODE_ENV=production` + `next start`) — ≥ 16 حرفاً ولا يساوي سرّ التطوير |
| `L27_CI_RUN` | يُطبع في سجل الخادم ليُطابَق مع فحص smoke 33 (إثبات استهلاك الحاوية المعزولة) |
| `L27_SERVER_LOG` | مسار سجل الخادم الذي يقرأه smoke لفحص المطابقة أعلاه |

**P2 — الإقلاع fail-closed:** `next start` على الإنتاج بلا سرّ صالح **لا يُقلع أصلاً**
(exit ≠ 0 ورسالة «رفض الإقلاع (fail-closed): …» من `next.config.mjs` ← `lib/runtime/config.mjs`).
القاعدة نقية ومُختبَرة (`tests/unit/runtime-config.test.ts` · `tests/unit/session-secret.test.ts`)
ومُثبَّتة على خادم حقيقي في خطوة CI «P2 fail-closed proof». `next build` مستثنى صراحةً
(السرّ لازم وقت التشغيل لا التجميع)، والتطوير/الاختبارات تعمل بسرّ التطوير بلا انحدار.
نموذج المتغيرات في `.env.example` — **لا أسرار حقيقية في المستودع**.

لإعادة إنتاج بوابة الإنتاج محلياً (نفس شروط CI):

```bash
NODE_ENV=production L27_DB_PATH=$PWD/var/local/db.json \
L27_SESSION_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))") \
npm start          # ثم في طرف آخر: npm run smoke (مرتين لإثبات الحتمية)
```

## النشر على Vercel — **BLOCKED (لا يُقدَّم VERIFIED قط)**

لم يُنفَّذ أي نشر في أي جلسة: بلا اعتماد Vercel وبلا وصول للحساب، فلا URL حيّ
ولا اختبار حيّ ⇒ الحالة **BLOCKED** وليست DEPLOYED.

ما هو جاهز تقنياً: Next.js قياسي + lockfile + CI أخضر. وما يلزم قبل أي نشر فعلي:

1. ربط الحساب على [vercel.com/new](https://vercel.com/new) أو `npx vercel login`.
2. تعريف `L27_SESSION_SECRET` في متغيرات بيئة Vercel (≥16 حرفاً، عشوائي) —
   **بدونه يفشل الإقلاع/البناء عمداً** (P2 fail-closed).
3. **`FileJson` ليس persistence إنتاجياً على Vercel:** القرص ephemeral في serverless،
   فالمحوّل الحالي يفقد البيانات بين الاستدعاءات ولا يتشاركها بين_instances.
   النشر الإنتاجي مشروط بمحولّ PostgreSQL فوق نفس `Repository Interface`
   (TODO موثّق في `lib/persistence/file-json.ts`) — بلا إعادة كتابة domain.

## المزامنة مع GitHub

آلية مثبتة عملياً: `CHANGE → COMMIT → PUSH → VERIFY_REMOTE` —
انظر [docs/sync-verification.md](docs/sync-verification.md).

قواعد ملزمة: لا commit قبل تغيير مقصود + بوابات خضراء · الدمج بإثبات `mergedAt ≠ null` ·
النشر = **DEPLOYED = VERIFIED** فقط بعد اختبار الـURL الحي فعلياً ·
ادعاء README ≠ حقيقة runtime ≠ إثبات CI — الثلاثة تُقاس كلٌّ على حدة ولا يُقدَّم أحدها بدل الآخر
(`FileJson` ليس persistence إنتاجياً على Vercel: القرص ephemeral — PostgreSQL لاحقاً فوق نفس الواجهة).
