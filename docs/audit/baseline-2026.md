# Baseline Audit — leader2027 (Phase 0)

**الغرض:** تثبيت خط أساس كامل ومُصنَّف للمستودع قبل أي إصلاح. هذا الملف **جرد وأدلة فقط** — لم يُعدَّل أي كود أثناء إنتاجه.

- **التاريخ:** 2026-09-26
- **الفرع:** `arena/01a0dfbf-leader2027`
- **خط الأساس (main):** `3635f5396deedc36180ad6811ab066c8bfe0bf35`
- **رأس الفرع (PR #6):** `cb44c4d4938ccaec674a5f4afc93961be027410b` — الفرق عن main: `4 files changed, 11 insertions(+)`
- **المستودع:** `https://github.com/sayedelazameydesign-crypto/leader2027` (عام، `default_branch = main`)

## منهجية التصنيف (لا «PASS» بلا دليل)

| الوسم | المعنى |
| --- | --- |
| `KNOWN` | حقيقة مثبتة بأمر فعلي أو `file:line` |
| `UNKNOWN` | لم يُحدَّد بعد — يحتاج فحصًا في مرحلة تالية |
| `NOT_VERIFIED` | الادعاء موجود لكن لا دليل تنفيذي يثبته هنا |
| `NOT_PRESENT` | غير موجود في المستودع (فحص وجود صريح) |
| `BLOCKED` | التعيين متعذّر من هذه البيئة (صلاحيات/شبكة/تبعية) |

---

## 1) Runtime & Framework

| البند | القيمة | الوسم | الدليل |
| --- | --- | --- | --- |
| Node (المحلي) | `v22.22.3` | KNOWN | `node -v` |
| npm (المحلي) | `10.9.8` | KNOWN | `npm -v` |
| Node (المُعلَن) | `22` | KNOWN | `project.manifest.json.node` + `ci.yml:29` + `t4-verify.yml:41` |
| `engines` في package.json | غير موجود | NOT_PRESENT | `node -e "…p.engines"` → `NOT_PRESENT` |
| `.nvmrc` | غير موجود | NOT_PRESENT | فحص وجود |
| Next.js | `16.3.6` | KNOWN | banner الخادم: `▲ Next.js 16.3.6` |
| React / React-DOM | `^19.3.0` | KNOWN | `package.json` |
| TypeScript | `^7.0.2` · `strict: true` | KNOWN | `package.json` + `tsconfig.json` |
| Vitest | `^5.0.2` | KNOWN | `package.json` |
| flags إضافية للصرامة | `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noImplicitOverride` **غير مفعّلة** · `allowJs: true` · `skipLibCheck: true` | KNOWN | `tsconfig.json` |

## 2) Dependencies & Supply Chain

| البند | القيمة | الوسم | الدليل |
| --- | --- | --- | --- |
| runtime deps | 4 (`next`, `react`, `react-dom`, `pg`) | KNOWN | `package.json` |
| dev deps | 6 (`@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`, `typescript`, `vitest`) | KNOWN | `package.json` |
| إجمالي الحزم في القفل | 152 (شاملة transitive) | KNOWN | `Object.keys(package-lock.json.packages).length` |
| lockfile blob SHA | `ca2e6f5c74262e9031cd6fdbfd877ca3405f4a80` | KNOWN | `git hash-object package-lock.json` |
| `npm ci` لا يعدّل القفل | SHA قبل = بعد | KNOWN | `npm ci` EXIT=0 ثم `git hash-object` مطابق |
| ثغرات معروفة | `info 0 · low 0 · moderate 0 · high 0 · critical 0 · total 0` | KNOWN | `npm audit --json` EXIT=0 |
| Dependabot | `.github/dependabot.yml` | NOT_PRESENT | فحص وجود |
| CodeQL / code scanning | workflow | NOT_PRESENT | فحص وجود (`codeql*.yml`) |
| OpenSSF Scorecard | workflow | NOT_PRESENT | فحص وجود |
| Secret scanning / push protection | تعذّرت القراءة | BLOCKED | `gh api …/secret-scanning/alerts` → `403 Resource not accessible by integration` · `security_and_analysis: null` |
| حاجة كل تبعية | `pg` مستخدمة في `lib/persistence/postgres.ts` + `outputFileTracingIncludes` في `next.config.mjs` | KNOWN | grep |
| تبعيات مكرّرة/غير مستخدمة | لم يُفحص | UNKNOWN | — (Phase 1) |

## 3) Scripts ↔ Files

11 سكربتًا في `package.json`: `dev, build, start, test, smoke, typecheck, readme:generate, readme:check, readme:drift, readme, readme:warn` — **كل الملفات المُستدعاة موجودة** (`scripts/generate-readme.mjs`, `scripts/check-manifest-drift.mjs`, `tests/smoke/smoke.mjs`) ⇒ KNOWN.

- `scripts/t4-verify.mjs` و`scripts/t4-deploy.sh` موجودان لكن **غير معرّضين كـnpm scripts** (يُستدعيان من `t4-verify.yml`/يدويًا) ⇒ KNOWN.
- سكربتات `lint` / `format` / `e2e` / `coverage` / `audit` ⇒ **NOT_PRESENT** (فحص مفاتيح `package.json.scripts`).

## 4) Routes & Pages (من مخرج البناء نفسه)

`npm run build` → **EXIT=0** · الجدول المطبوع = **35 مسارًا**: 22 API + 12 صفحة + `/_not-found`.

**API (22) مع الطرق المُصدَّرة فعليًا:**

| المسار | الطرق | المسار | الطرق |
| --- | --- | --- | --- |
| `/api/auth/login` | POST | `/api/kernel` | GET, PATCH |
| `/api/auth/logout` | POST | `/api/kernel/cells` | GET |
| `/api/campaign` | GET, PATCH | `/api/kernel/actions` | POST |
| `/api/cycles` | GET, POST | `/api/mcp` | POST, **GET→405** |
| `/api/cycles/[id]` | PATCH | `/api/debug/headers` | GET |
| `/api/field/reports` | GET, POST | `/api/health` | GET (غير async) |
| `/api/field/reports/[id]` | GET, PATCH | `/api/people` · `/api/people/[id]` | GET,POST · GET,PATCH |
| `/api/regions` · `/api/teams` | GET, POST | `/api/volunteers` · `/[id]` | GET,POST · GET,PATCH |
| `/api/stats` | GET | `/api/users` · `/api/users/[id]` | GET,POST · PATCH |

**الصفحات (12):** `app/(app)/{page, admin, admin/users, kernel, people, people/[id], volunteers, volunteers/[id], field/reports, field/reports/[id], field/reports/new}` + `app/login/page.tsx` · **Layouts (2):** `app/layout.tsx`, `app/(app)/layout.tsx`.

- `middleware.ts` ⇒ **NOT_PRESENT**؛ الحراسة تتم في كل صفحة عبر `requirePageUser()` (`lib/auth/page.ts:9`) — **كل الـ11 صفحة داخل `(app)` + الـlayout تستدعيها** ⇒ KNOWN (فحص grep).
- كل صفحات `(app)` محروسة، و`/login` خارجها ⇒ KNOWN.

## 5) Environment Variables

| المصدر | العدد | التفاصيل | الوسم |
| --- | --- | --- | --- |
| `manifest.env` (مُعلَن) | 17 | كل المتغيرات موثّقة في README‑in | KNOWN |
| مسح شامل للكود (`process.env.*` في `*.ts/tsx/mjs/js`) | 20 | — | KNOWN |
| مستخدم وغير مُعلَن | 3 | `BASE_URL` (smoke فقط — مستثنى صراحةً في `check-manifest-drift.mjs:146`) · `L27_T4_LOGIN_EMAIL` · `L27_T4_LOGIN_PASSWORD` (`scripts/t4-verify.mjs`) | KNOWN — فجوة توثيق |
| مُعلَن وغير مستخدم | 0 | — | KNOWN |
| `.env.example` | 3 فقط | `DATABASE_URL`, `L27_SESSION_SECRET`, `L27_STORE` (من 17 موثّقًا) | KNOWN — فجوة توثيق |
| سبب عدم كشفها | كاشف الانحراف يمسح **قائمة 8 ملفات مثبّتة** (`check-manifest-drift.mjs:131-140`) لا كل المستودع | KNOWN |

## 6) Roles / Actions / Matrix

- **6 أدوار** (`lib/authorization/roles.ts:1-8`): OWNER, CAMPAIGN_ADMIN, CAMPAIGN_MANAGER, FIELD_COORDINATOR, FIELD_WORKER, VIEWER ⇒ KNOWN.
- **14 إجراءً** (`lib/authorization/policy.ts:3-17`) ⇒ KNOWN.
- توزيع المصفوفة: OWNER 14 · CAMPAIGN_ADMIN 14 · CAMPAIGN_MANAGER 14 · FIELD_COORDINATOR 12 · FIELD_WORKER 6 · VIEWER 4 ⇒ KNOWN.
- مطابقة المصفوفة بين الكود والـmanifest إجراءً بإجراء: `readme:drift --strict` EXIT=0 ⇒ KNOWN.
- **اختبار آلي شامل (role × action × resource)**: الموجود `tests/unit/policy.test.ts` (عينات محددة) — لا اجتياز كامل للمصفوفة ⇒ NOT_VERIFIED (Phase 4).
- `Resource.team_id` مُعلَن في النوع (`policy.ts:22,27`) و**لا يُستخدم في `can()` إطلاقًا** ⇒ KNOWN — حقل غير مُنفَّذ (F‑02).

## 7) Persistence & Repositories

- **9 واجهات مستودعات** (`lib/repositories/interfaces.ts:56-115`): People, Volunteers, FieldReports, Users, Regions, Teams, Campaign, Cycles, Audit + نوع `Repos` ⇒ KNOWN.
- **المحوّلات:** `memory.ts`, `file-json.ts`, `postgres.ts` (+ `write-through.ts`, `sync-pg.ts`, `pg-child.mjs`, `schema.sql`, `seed.ts`)؛ التركيب في `lib/repositories/container.ts:25-35` حسب `L27_STORE` (افتراضي `file`) ⇒ KNOWN.
- **نموذج التخزين في Postgres:** جدول `l27_store` بصف واحد `doc JSONB` (`schema.sql:3-8`) — «مستند واحد للـStore (دلالات LWW على مستوى المستند)» ⇒ KNOWN.
- **نتيجة بنيوية:** لا قيود على مستوى الكيان (لا `NOT NULL` على `reported_by` مثلًا)؛ القراءة `rows[0].doc as Store` (`postgres.ts:64-66`) **بلا تحقق运行时** ⇒ KNOWN (أصل F‑01).
- جدول المُخدد `l27_rate` + فهرس `window_start` ⇒ KNOWN.
- **تكافؤ الدلالات بين المحوّلات الثلاثة:** مجموعة عقدية موجودة (`tests/integration/persistence-contract.test.ts`) لكن فرع Postgres `describe.skipIf(!pgUrl)` ⇒ **محليًا NOT_VERIFIED (8 اختبارات متخطاة)** · في CI يُضبط `L27_TEST_DATABASE_URL` مع خدمة `postgres:16` (`ci.yml:12-35`) والخطوة `success` ⇒ KNOWN، لكن **سجل CI التفصيلي BLOCKED** (`gh run view --log` فشل: تعذّر الوصول إلى `results-receiver.actions.githubusercontent.com`).
- **التزامن/الفقدان التحديثي (lost update):** لا اختبار لكاتبين متزامنين على المستند الواحد ⇒ NOT_VERIFIED (F‑10, Phase 8).

## 8) Kernel / Cells / MCP

- **النواة (7 ملفات):** `types.ts, manifest.ts, registry.ts, bus.ts, kernel.ts, approvals.ts, bridge.ts` ⇒ KNOWN.
- **8 أنوية ذرية** (`lib/cells/*`): ai (قدرة `ai.catalogue`, `ai.approvals`) · audit (`audit.read`) · auth (`auth.login`, `auth.session`) · field (`field.reports.read/write`) · people (`people.read/write`) · reporting (`reporting.kpis`) · settings (`settings.campaign`, `settings.structure`) · volunteers (`volunteers.read/write`) ⇒ KNOWN.
- **عزل الأنوية:** `readme:drift` يثبته — «لا استيراد بين نواة وأخرى (8)» + «الأنوية لا تلمس النواة ولا المخزن مباشرة» EXIT=0 ⇒ KNOWN.
- **عدد الأدوات الكلي:** **27** ⇒ KNOWN (`tests/smoke/smoke.mjs:635` يفحص `tools.length === 27` · smoke M2 `tools=27`).
- **بوابة MCP:** `tools/list` من `kernel.tools()` (`lib/mcp/server.ts:148`) · معيار أداة الكتابة `requiresApprovalForAgents || risk === "write" || "admin"` (`server.ts:70-72`) · الكتابة **تُرفض قبل التنفيذ** وتُسجَّل `mcp.write.denied` بمعرّف الجلسة (`server.ts:179`) · `readOnlyHint` للقراءة (`server.ts:155`) ⇒ KNOWN.
- **دورة الاعتماد:** single-use مثبتة تشغيليًا في smoke `K11` ⇒ KNOWN؛ **انتهاء صلاحية الاعتماد (expiry)** و**ربط الممثل (actor binding)** تحت سباق زمني ⇒ NOT_VERIFIED (Phase 9).
- **طريق `field.update_notes`:** الأداة → `ctx.require("field.reports.write")` → `updateNotes` (`lib/cells/field/index.ts:134-136`) → `updateReport()` في الخدمة (`lib/domain/field/service.ts`) ⇒ KNOWN: **كل الأسطح (HTTP/نواة/MCP) تمرّ من نقطة تفويض واحدة**.

## 9) Tests

| البند | القيمة | الوسم | الدليل |
| --- | --- | --- | --- |
| ملفات الاختبار | 24 (`tests/unit` 13 · `tests/integration` 11) + `tests/smoke/smoke.mjs` | KNOWN | `find` |
| `npm test` (محليًا) | **EXIT=0** · 24 ملفًا · **229 ناجح · 8 متخطّى (237)** | KNOWN | تنفيذ فعلي |
| سبب التخطي | `describe.skipIf(!pgUrl)` في `persistence-contract.test.ts:130` و`http-guards.test.ts:211` — `L27_TEST_DATABASE_URL` غير مضبوط محليًا | KNOWN | grep |
| smoke على `next start` حقيقي | **EXIT=0 · 49/49 passed** (يشمل AC1‑11 · K1‑K14 · M1‑M4) | KNOWN | تنفيذ فعلي + `/tmp/smoke.log` |
| Coverage | لا مزوّد ولا عتبات (`vitest.config.ts` بلا `coverage`) | NOT_PRESENT | `cat vitest.config.ts` |
| قياس تغطية القواعد الحرجة | — | BLOCKED | يتطلب `@vitest/coverage-v8` (تبعية جديدة — ممنوعة بلا إثبات حاجة) |
| E2E متصفح | Playwright غير مثبت | NOT_PRESENT | فحص `package.json` |
| اختبارات الخصائص/الثوابت (property-based) | غير موجودة | NOT_PRESENT | فحص |
| اختبارات التزامن/السباق | غير موجودة | NOT_PRESENT | فحص |

## 10) CI / Workflows

| البند | الحالة | الوسم |
| --- | --- | --- |
| `ci.yml` — المشغّل | `push` + `pull_request` | KNOWN |
| خطوات `verify` | checkout@v7 · setup-node@v7 (22, cache npm) · `npm ci` · `npm run typecheck && npm test` (مع `L27_TEST_DATABASE_URL` + خدمة `postgres:16`) · `npm run build` · `npm start` + `npm run smoke` · README generation · drift | KNOWN |
| بوابات **مانعة** | typecheck · tests · build · smoke | KNOWN |
| بوابات **استشارية** | `README generation` و`Manifest drift check` بـ`continue-on-error: true` (`ci.yml:54-59`) ⇒ **لا تمنع الدمج** | KNOWN (F‑06) |
| `t4-verify.yml` | `workflow_dispatch` **يدوي فقط** (T4‑1/2/3/6 · T4‑7 smoke حيّ · T4‑4/5 تأكيدات بلا أسرار) | KNOWN |
| lint / format / audit / e2e / coverage / codeql / scorecard | غير موجودة في أي workflow | NOT_PRESENT |
| نتيجة CI على `cb44c4d` | run `36275941017` (pull_request) و`36275916721` (push) → **completed/success**، وكل الخطوات success (1‑10) | KNOWN |

## 11) Security Surface (جرد، لا أحكام)

| الآلية | الموضع | الوسم |
| --- | --- | --- |
| توقيع الجلسة HMAC + مقارنة آمنة | `lib/auth/session.ts:1,71` (`createHmac`, `timingSafeEqual`) | KNOWN |
| اسم الكوكي | `l27_session` (`session.ts:3`) | KNOWN |
| رفض السر الافتراضي في الإنتاج + استثناء صريح | `session.ts:27-47` (`L27_ALLOW_INSECURE_SECRET`) | KNOWN |
| إبطال الجلسة بتغيّر الدور (epoch) | `lib/auth/request.ts:21-22` (`payload.ep !== user.session_epoch → null`) | KNOWN |
| كلمات المرور | `scryptSync` + `timingSafeEqual` (`lib/auth/password.ts:1,19`) | KNOWN |
| ثقة الحافة وهوية العميل | `lib/http-guards.ts:42 trustedEdge()`, `:53 clientIp()` (`L27_TRUST_EDGE`, `L27_CLIENT_IP_HEADER`) | KNOWN |
| فحص الأصل/المضيف (CSRF) | `lib/http-guards.ts:80 assertSameOrigin()` + `L27_ALLOWED_HOSTS` | KNOWN |
| مُخدد المعدل | `lib/rate-limit.ts` — خلفيتان `MemoryRateLimiter:36` / `PostgresRateLimiter:62` · `getRateLimiter():133` · `checkRateLimit():151` | KNOWN |
| **نطاق تطبيق المُخدد** | **موضعان فقط:** `app/api/auth/login/route.ts:7` و`app/api/mcp/route.ts:23` — بقية الـ20 route بلا تحديد معدل | KNOWN (F‑11) |
| route التشخيص | `app/api/debug/headers/route.ts:14` — 404 إلا مع `L27_DEBUG_HEADERS=1` · يعكس 3 ترويسات فقط | KNOWN |
| عزل حسابات العرض | `lib/persistence/seed.ts` + `L27_SEED_DEMO_ACCOUNTS` / `L27_DEMO_PASSWORD` · `tests/unit/seed-isolation.test.ts` | KNOWN |
| التدقيق | **16 موضع `recordAudit(`** تغطي كل طفرات النطاق (people/volunteers/reports/users/settings) + `mcp.call` / `mcp.write.denied` | KNOWN |
| ثابت «كل طفرة ⇒ سجل تدقيق» | لا اختبار يثبته كـinvariant شامل | NOT_VERIFIED (F‑15, Phase 14) |
| اختبارات العبث بالجلسة (tamper/expiry/replay/fixation) | `tests/unit/auth-session.test.ts` (8) + `tests/integration/auth-hardening.test.ts` — **عمق التغطية لم يُقيَّم بعد** | NOT_VERIFIED (Phase 3) |

## 12) Deployment Configuration

| البند | الحالة | الوسم |
| --- | --- | --- |
| `vercel.json` / `Dockerfile` | غير موجودة | NOT_PRESENT |
| إعداد التتبع | `next.config.mjs: outputFileTracingIncludes` يشمل `pg-child.mjs` و`node_modules/pg/**` | KNOWN |
| `scripts/t4-deploy.sh` | link · env add (SESSION_SECRET, TRUST_EDGE, STORE, DATABASE_URL, DEMO×2, DEBUG_HEADERS) · `deploy --prod` · **finalize يحذف `L27_SEED_DEMO_ACCOUNTS` و`L27_DEMO_PASSWORD` و`L27_DEBUG_HEADERS`** · ثم `L27_ALLOWED_HOSTS` | KNOWN |
| `productionChecklist` | 7 بنود T4‑1..T4‑7 في الـmanifest | KNOWN |
| Vercel على PR #6 | `Vercel :: SUCCESS` + `Vercel Preview Comments :: COMPLETED/SUCCESS` | KNOWN |
| **التحقق الحيّ من النشر** | `t4-verify.yml` يدوي، ولم يُشغَّل في هذه الجلسة؛ لا تعديل على الأسرار/الصلاحيات مسموح | NOT_VERIFIED (F‑13) |
| صحة `DEPLOYED ⇒ VERIFIED` | **غير مقبولة** — لم يُفحص الرابط الحيّ | NOT_VERIFIED |

## 13) Documentation Contracts

- `project.manifest.json` = مصدر الحقيقة؛ `README.md` و`README.en.md` **مشتقّان** عبر `scripts/generate-readme.mjs` ⇒ KNOWN.
- `npm run readme:check` → **EXIT=0** (`OK README.md` · `OK README.en.md`) ⇒ KNOWN.
- `npm run readme:drift -- --strict` → **EXIT=0** · «✅ لا انحراف» (المتغيرات 17/17 · مسارات API 22/22 · الأدوار 6 · الإجراءات 14 · المصفوفة · الحسابات 6 · الأنوية 8 · الوثائق 9 · المخرجات 2) ⇒ KNOWN (بعد PR #6).
- 9 وثائق مُعلَنة و9 موجودة، وكل مراجع README إليها سليمة (فحص رابط‑برابط) ⇒ KNOWN.
- **تسريب لغة:** 5 مدخلات `env` تحمل `note` كنص عربي (لا `{ar,en}`) فتطبع العربية داخل `README.en.md`: `L27_SEED_DEMO_ACCOUNTS`, `L27_CLIENT_IP_HEADER`, `L27_TRUST_EDGE`, `L27_DEMO_PASSWORD`, `L27_DEBUG_HEADERS` (المولّد `t()` يعيد النص كما هو: `generate-readme.mjs:47-53`) ⇒ KNOWN (F‑05).
- `structure["app/api/"]` في الـmanifest يذكر 11 عائلة فقط ولا يذكر `kernel` / `mcp` / `debug` ⇒ KNOWN — تقادُم غير مفحوص من الكاشف (F‑04).
- `docs/audit/baseline-2026.md` (هذا الملف) **غير مُعلَن في `manifest.docs`** — إضافة إعلانه تُغيّر README‑in (المولّد يصيّر جدول الوثائق: `generate-readme.mjs:276-283`). يُترك لمرحلة Documentation as Code ⇒ KNOWN (F‑16).

---

## سجل النتائج (Findings Register)

| # | النتيجة | التصنيف | الدليل | المرحلة |
| --- | --- | --- | --- | --- |
| **F‑01** | `can()` **fail-open بالتكوين** لـ`reports:update_notes` عندما `resource.reported_by === undefined`: الشرط `policy.ts:74-80` يُتخطى فيُعاد `true` (`:82`). غير قابل للوصول اليوم عبر المسارات المُنمَّذجة (نقطة التفويض الوحيدة `service.ts:85` تمرر `existing.reported_by` ونوعه `string` إلزامي في `field-report.ts:10`)، **لكن** التخزين مستند JSONB واحد بلا قيود ولا تحقق عند القراءة (`schema.sql:3-8`, `postgres.ts:64-66`) ⇒ سجل ناقص الحقل يمنح أي FIELD_WORKER. **لا اختبار يغطي فرع `undefined`** (`policy.test.ts:66-68` يغطي القيم المعرّفة فقط) | NOT_VERIFIED — SECURITY REVIEW REQUIRED | `policy.ts:70-83` · `service.ts:85` · `field-report.ts:10` · `schema.sql:3-8` | 2 → 4 |
| **F‑02** | `Resource.team_id` مُعلَن ولا يُستخدم في `can()`؛ `listReports` يعيد **كل** التقارير لكل من يملك `reports:view` (بما فيه FIELD_WORKER). لا ادعاء موثّق بحصر فريقي في الـmanifest/الوثائق (grep فارغ) ⇒ ليس خرق عقد موثّق، بل حقل غير مُنفَّذ يحتاج قرارًا: تنفيذ أو حذف | KNOWN (سلوك) / UNKNOWN (المقصود) | `policy.ts:22,27` · `service.ts:102-108` | 4 |
| **F‑03** | 3 متغيرات بيئة مستخدمة وغير مُعلَنة: `BASE_URL` (smoke) · `L27_T4_LOGIN_EMAIL` · `L27_T4_LOGIN_PASSWORD` (t4‑verify). السبب: كاشف الانحراف يمسح قائمة ملفات مثبّتة لا المستودع كله | KNOWN | مسح شامل مقابل `manifest.env` · `check-manifest-drift.mjs:131-146` | 13/15 |
| **F‑04** | `.env.example` يغطي 3 من 17 متغيرًا موثّقًا؛ و`structure["app/api/"]` لا يذكر `kernel`/`mcp`/`debug` | KNOWN | `grep -o "^[A-Z_0-9]*" .env.example` · `manifest.structure` | 15 |
| **F‑05** | تسريب العربية إلى `README.en.md` في 5 مدخلات `env` (نمط `note` كنص لا `{ar,en}`) | KNOWN | `README.en.md` السطور 159‑168 · `generate-readme.mjs:47-53` | 13/15 |
| **F‑06** | بوابتا README/drift في CI **استشاريتان** (`continue-on-error: true`) ⇒ لا تمنعان الدمج؛ لا يجوز اعتبارهما بوابات صحة | KNOWN | `ci.yml:54-59` | 16 |
| **F‑07** | `manifest.api` يعلن `/api/mcp` كـPOST فقط بينما الـroute يصدّر `GET` يعيد 405 + `Allow: POST`. انحراف الطرق **غير مفحوص** من الكاشف (يقارن المسارات فقط) | KNOWN | `app/api/mcp/route.ts:117` · `check-manifest-drift.mjs:172-184` | 6/13 |
| **F‑08** | منظومة الجودة الناقصة: lint/format/E2E/coverage/CodeQL/Dependabot/Scorecard ⇒ كلها **NOT_PRESENT** | NOT_PRESENT | فحص وجود ملفات + مفاتيح `package.json` | 1/10/12/14/16 |
| **F‑09** | تكافؤ دلالات المحوّلات الثلاثة غير مثبت محليًا (8 اختبارات `skipIf`)؛ الإثبات في CI قائم لكن **سجل التفصيلي BLOCKED** (تعذّر جلب سجل run) | NOT_VERIFIED / BLOCKED | `persistence-contract.test.ts:130` · `ci.yml:12-35` · فشل `gh run view --log` | 7 |
| **F‑10** | لا اختبار تزامن/Idempotency: مستند واحد LWW + `withWriteThrough` ⇒ احتمال فقد تحديثات بين كيانات مختلفة؛ `l27_rate` يحتاج إثباتًا تحت السباق | NOT_VERIFIED | `schema.sql:2` · `postgres.ts:37` · `write-through.ts` | 8 |
| **F‑11** | تحديد المعدل مطبّق على **2 من 22** route (login, mcp)؛ البقية بلا حماية من الإغراق/التكرار | KNOWN | grep `checkRateLimit` | 3/6 |
| **F‑12** | حالة secret scanning / push protection غير قابلة للتحقق من هذا التوكن | BLOCKED | `gh api …/secret-scanning/alerts` → 403 | 10 |
| **F‑13** | النشر الحيّ: Vercel Preview ناجح، لكن `t4-verify.yml` يدوي ولم يُشغَّل ⇒ **DEPLOYED ≠ VERIFIED** | NOT_VERIFIED | فحوص PR #6 · `t4-verify.yml:13-14` | 15/17 |
| **F‑14** | `middleware.ts` غير موجود ⇒ لا بوابة عامة؛ كل صفحة/route يحرس نفسه. النمط الحالي متسق (**11/11** صفحة داخل `app/(app)` تستدعي `requirePageUser` + الـlayout، و`app/login/page.tsx` خارج المجموعة بتصميم مقصود) لكنه **هشّ بنيويًا**: أي صفحة جديدة بلا حارس = ثغرة صامتة، ولا اختبار يثبته | KNOWN / NOT_VERIFIED (كـinvariant) | `lib/auth/page.ts:9` · grep الصفحات | 3/6 |
| **F‑15** | 16 موضع تدقيق تغطي الطفرات، لكن لا invariant شامل «كل طفرة ⇒ AuditEvent» ولا فحص لترتيب/ارتباط الأحداث | KNOWN / NOT_VERIFIED | grep `recordAudit(` | 14 |
| **F‑16** | هذا الملف غير مُعلَن في `manifest.docs` (قرار مقصود لإبقاء Phase 0 إضافيًا بحتًا) | KNOWN | `generate-readme.mjs:276-283` | 15 |
| **F‑17** | dead files / dead routes / circular imports / duplicate logic / orphan components / unused deps | UNKNOWN | لم يُفحص | 1 |
| **F‑18** | عقد كل endpoint (مخطط طلب/استجابة، أكواد الحالة، 4xx≠5xx، side effects، idempotency) غير مُعلَن ولا مُختبر منهجيًا | UNKNOWN | — | 6 |
| **F‑19** | حالات الفشل (قاعدة بيانات غير متاحة، DSN خاطئ، متجر تالف، env ناقص) — بعضها مغطى جزئيًا (`session-secret`, `postgres-adapter`) ولا يوجد اختبار فشل شامل | UNKNOWN | — | 12 |

---

## ملخص ما لا نعرفه (صراحةً)

**REMAINING_UNKNOWN:** F‑17 (السلامة البنيوية: dead code/duplicates/circular) · F‑18 (عقود الـendpoints) · F‑19 (هندسة الفشل) · المقصود من `Resource.team_id` (F‑02) · عمق تغطية اختبارات العبث بالجلسة.

**NOT_VERIFIED:** F‑01 (فرع fail‑open) · F‑09 محليًا (تكافؤ المحوّلات) · F‑10 (التزامن/الفقد التحديثي) · F‑13 (التحقق الحيّ) · F‑14 كـinvariant · F‑15 كـinvariant · المصفوفة الشاملة role×action×resource · انتهاء صلاحية الاعتماد وربط الممثل تحت السباق.

**NOT_PRESENT:** lint · format · E2E/Playwright · coverage · CodeQL · Dependabot · Scorecard · `vercel.json` · `Dockerfile` · `.nvmrc` · `engines` · اختبارات property/concurrency · `middleware.ts`.

**BLOCKED:** F‑12 (secret scanning — 403) · سجل CI التفصيلي (شبكة) · قياس التغطية (يتطلب تبعية جديدة) · أي تشغيل يتطلّب أسرار نشر حقيقية.

---

## أوامر إعادة الإنتاج (كل دليل في هذا الملف)

```bash
node -v && npm -v && npm ls --depth=0
node -e "console.log(Object.keys(require('./package-lock.json').packages).length)"
git hash-object package-lock.json && npm ci && git hash-object package-lock.json
npm audit --json
find app/api -name route.ts | sort && find app -name page.tsx | sort
grep -rho "process\.env\.[A-Za-z_0-9]*" --include="*.ts" --include="*.tsx" --include="*.mjs" . \
  --exclude-dir=node_modules --exclude-dir=.next | sed 's/process\.env\.//' | sort -u
npm run typecheck && npm test && npm run build
npm start & BASE_URL=http://127.0.0.1:3000 L27_DEMO_PASSWORD=… npm run smoke
npm run readme:check && npm run readme:drift -- --strict
gh pr view 6 --json statusCheckRollup && gh run list --branch arena/01a0dfbf-leader2027
```

> **قاعدة هذا التقرير:** لا يوجد فيه بند `PASS` واحد بلا exit code أو مخرج أمر أو `file:line`.
