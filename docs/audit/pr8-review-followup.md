# PR #8 — متابعة المراجعة: عقد التفويض (D‑01 · F‑01a · F‑01b · F‑20)

**الغرض:** إغلاق مراجعة PR #8 على نفس عقد التفويض دون توسيع النطاق: تثبيت قرار عقد الممثل (D‑01)، إثبات
إصلاح F‑01a/F‑01b بالأدلة، وتسجيل F‑20 كنتيجة **منفصلة ومصنَّفة** بلا أي تعديل عليها هنا.
هذا الملف **مراجعة وأدلة**؛ التغيير البرمجي الوحيد المصاحب له هو 4 اختبارات + تعليق عقدي على النوع `Actor`.

- **التاريخ:** 2026-09-26
- **PR #8:** `fix: reconcile authorization fail-open + explicit default-deny (F-01a/F-01b)` — الحالة عند بدء المراجعة: **OPEN** (`mergedAt = null`, `mergeCommit = null`)
- **رأس PR #8:** `570376c9b8d8dfb8ab95a5ee3881f7321b4ff039` على `arena/01a0dfbf-leader2027` · القاعدة `main` = `3548d58348a7979f4a38d5b01666e31321609b61` (= merge‑base؛ commit واحد فوق main)
- **CI على الرأس:** `verify` **SUCCESS** ×2 (push + pull_request) · Vercel SUCCESS · `mergeStateStatus = CLEAN`
- **PR #6 / PR #7:** MERGED (`e134702` / `3548d58`) — مثبت بـ`gh pr view`
- **فرع جلسة المراجعة:** `arena/01a0e000-leader2027` — أُلحق برأس PR #8 بـ`git merge --ff-only` (بلا commit دمج، SHA الرأس نفسه)

وسوم التصنيف كما في `baseline-2026.md`: `KNOWN` · `NOT_VERIFIED` · `NOT_PRESENT` · `UNKNOWN` · `BLOCKED` — **لا `PASS`/`VERIFIED` بلا exit code أو `file:line`.**

---

## Phase A — الفحص (بلا تعديل)

| الفحص | النتيجة | الوسم |
| --- | --- | --- |
| `docs/audit/pr8-review-followup.md` في الشجرة قبل هذه المراجعة | **NOT_PRESENT** — ولا في رأس PR #8 (`git ls-tree`) | KNOWN |
| `git diff -- docs/audit/baseline-2026.md` / `policy.ts` / `policy-matrix.test.ts` قبل المراجعة | فارغ — لا متابعة محفوظة محليًا، ولا stash | KNOWN |
| وسم `D-01` / `F-20` في أي ملف (main أو رأس PR #8) | **NOT_PRESENT** (`grep` فارغ) — سجل النتائج ينتهي عند F‑19 | KNOWN |
| ملفات PR #8 | `lib/authorization/policy.ts` (+23/−9) · `tests/unit/policy-matrix.test.ts` (+195) · `tests/integration/api-field-reports.test.ts` (+99) | KNOWN |

**الاستنتاج:** المتابعة السابقة فُقدت؛ أُعيد بناؤها هنا **من الأدلة الحالية وقرار D‑01 فقط** — لا اختراع.

---

## D‑01 — عقد الممثل (Actor contract) · القرار: **OPTION B**

### الخياران

| | المبدأ | الأثر |
| --- | --- | --- |
| **OPTION A** (مرفوض) | `actor.id` شرط عام: أي قرار تفويض يبدأ بالتحقق من `id` نصًا غير فارغ | يغيّر دلالات 83 زوجًا لا تحتاج هوية؛ يخلط المساءلة (التدقيق) بالتفويض (المصفوفة)؛ يخالف مسار النواة الذي يُسقط الهوية احتياطيًا |
| **OPTION B** (معتمد) | `role` مفتاح القرار؛ `id` يُشترط **فقط** حيث تتطلب القاعدة هوية/ملكية | لا تغيير في 6×14؛ قاعدة الملكية fail‑closed؛ لا validation عام؛ لا عزل فرق |

### الأدلة العقدية

| المصدر | الدليل | ما يثبته |
| --- | --- | --- |
| `project.manifest.json` → `matrix` / `actions` / `roles` | المصفوفة **دور × إجراء** (6×14 = 84) بلا بُعد هوية؛ `readme:drift --strict` يطابقها مع `MATRIX` إجراءً بإجراء (`scripts/check-manifest-drift.mjs:98-114`) EXIT=0 | التفويض العقدي قائم على الدور |
| `project.manifest.json` → `principles` | «الصلاحيات تُفرض على الخادم (policy + service + API)» | نقطة التنفيذ واحدة: `can()` |
| `docs/contract-vs3.md` §الصلاحيات | «بقية صفوف مصفوفة §4 دون تغيير» · «تغيير مصفوفة §4 القائمة» خارج النطاق | لا يجوز لـ D‑01 تغيير نتائج المصفوفة |
| `docs/contract-vs5.md` §2/5 و§7 | «التفويض بالجلسة البشرية فقط … لا سلطة تُمنح ولا تُزاد» | الهوية الوكيلية تُسجَّل في **التدقيق**، لا تدخل في قرار السلطة |
| `docs/kernel.md` §3/5 | «تفويض لا تصعيد: العملية تُنفَّذ بسلطة المُعتمِد (`decidedByRole`)، ودور مجهول ⇒ رفض افتراضي» | مفتاح الرفض الافتراضي هو **الدور** |
| `lib/kernel/kernel.ts:629-632` | `effectiveActor = { id: approval.decidedBy ?? actor.id, role: approval.decidedByRole ?? "UNKNOWN" }` | الهوية تسقط احتياطيًا؛ الدور المجهول يصبح `UNKNOWN` ⇒ منع — أي أن النواة نفسها لا تعامل `id` كشرط تفويض |
| `lib/kernel/bridge.ts:16-25` | `toDomainActor`: «دور غير معروف يُمرَّر كما هو … ⇒ منع افتراضي لكل إجراء» | نفس المبدأ عند الجسر |
| `lib/domain/field/service.ts:85` | `can(actor, "reports:update_notes", { reported_by: existing.reported_by })` | **الموضع الوحيد** الذي يمرّر سياق ملكية ⇒ القاعدة الوحيدة التي تستهلك `actor.id` |
| `baseline-2026.md` F‑02 | `Resource.team_id` مُعلَن ولا يُستخدم؛ لا ادعاء موثّق بحصر فريقي | عزل الفرق قرار مؤجل — ليس جزءًا من D‑01 |

### مطابقة التنفيذ (رأس PR #8) لـ D‑01 — تحقق تجريبي

مسبار خارج المستودع (`node --experimental-strip-types`) شغّل `can()`/`actionsFor()` الحقيقيين على نسختين:

| الفحص | رأس PR #8 (`570376c`) | قبل الإصلاح (`origin/main`) |
| --- | --- | --- |
| B‑1: ممثل **بلا `id`** بدور صالح — 84 زوجًا: مطابق للمصفوفة، ويختلف عن ممثل بهوية في زوج الملكية وحده | ✅ (84/84 · الفرق = `[FIELD_WORKER × reports:update_notes]`) | ✅ (نفس الشيء — لم يكن هناك validation عام) |
| B‑2: الهوية شرط في قاعدة الملكية فقط — لا مساواة عرضية: `undefined/undefined`, `""/""`, `7/7`, `null/null`, بلا مورد ⇒ **منع** | ✅ 5/5 منع | ❌ **5/5 منح** (fail‑open) |
| B‑3: الأدوار الأربعة الأعلى بلا `id` ⇒ `reports:update_notes` مسموح؛ VIEWER ممنوع | ✅ | ✅ |
| B‑4: `actionsFor` = صف المصفوفة؛ `team_id` (ممثل/مورد) بلا أثر على أي من 84 | ✅ | ✅ |
| F‑01b: دور باسم من `Object.prototype` / مجهول / غير نصي / ممثل `null` ⇒ `false` **بلا رمي** | ✅ | ❌ `TypeError` في 4 أدوار prototype + ممثل `null`/`undefined` |

**النتيجة:** التنفيذ في رأس PR #8 **يطابق D‑01 = OPTION B** في بنوده الخمسة: `id` ليس شرطًا عامًا (B‑1) · إلزامي حيث تلزم الهوية (B‑2) · لا validation عام (B‑1/B‑4) · لا تغيير في 6×14 (B‑1 + اختبار الـ84 في PR #8 + `readme:drift`) · لا عزل فرق (B‑4). ⇒ **D‑01 VERIFIED** (بالمسبار + الاختبارات أدناه).

### ما أُضيف لتثبيت القرار (الدلتا)

`tests/unit/policy-matrix.test.ts` — كتلة `describe("D-01 — عقد الممثل: OPTION B …")` بأربعة اختبارات:

| الاختبار | يثبّت | دليل التمييز (mutation check — الملف أُعيد بعده CLEAN) |
| --- | --- | --- |
| **D‑01/1** | `id` ليس شرطًا عامًا: 4 أشكال هوية غائبة/تالفة × 84 زوجًا ⇒ 83 مطابقة + زوج الملكية منع | يسقط على **OPTION A** (validation عام مُقحَم) |
| **D‑01/2** | لا مساواة عرضية في قاعدة الملكية؛ المنح بمطابقة صريحة فقط | يسقط على **كود ما قبل الإصلاح** (يربط D‑01 بـF‑01a) |
| **D‑01/3** | نطاق القاعدة `FIELD_WORKER` وحده؛ الأدوار الأخرى بلا هوية مسموحة | يسقط على **OPTION A** |
| **D‑01/4** | لا عزل فرق: `team_id` مختلف/غائب لا يغيّر أيًا من 84 | يسقط عند **إقحام عزل فرق** في `can()` |

نتيجة فحص الطفرات: pre‑fix ⇒ `1 failed | 3 passed` · OPTION A ⇒ `2 failed | 2 passed` · team‑isolation ⇒ `1 failed | 3 passed` · رأس PR #8 + الدلتا ⇒ `22/22 passed`.

`lib/authorization/policy.ts` — تعليق JSDoc على النوع `Actor` يوثّق D‑01 عند تعريف العقد. **لا تغيير سلوكي** (`can`/`actionsFor`/`MATRIX` كما في `570376c`).

---

## F‑01a / F‑01b — الحالة بالأدلة

| | التعريف | الإصلاح (رأس PR #8) | الدليل | الحالة |
| --- | --- | --- | --- | --- |
| **F‑01a** | fail‑open في قاعدة الملكية: `resource.reported_by === undefined` كان يتخطى القاعدة ⇒ `true` | `typeof owner === "string" && owner.length > 0 && owner === actor.id` | وحدة: كتلة F‑01a (8) + D‑01/2 · HTTP: `api-field-reports.test.ts` «F‑01a … ⇒ 403 ولا كتابة» (تلف يُحقن في المخزن) · المسبار B‑2: 5/5 منع (كانت 5/5 منح) | **VERIFIED** (اختبارات محلية EXIT=0 + CI `verify` SUCCESS) — بانتظار الدمج |
| **F‑01b** | `MATRIX[role]` على دور باسم من `Object.prototype` ⇒ دالة ⇒ `TypeError` ⇒ 500 بدل 403 | `typeof role !== "string" || !Object.hasOwn(MATRIX, role)` ⇒ `false`؛ `actionsFor` ⇒ `[]` | وحدة: كتلة F‑01b (4) · HTTP: «دوره اسم من Object.prototype ⇒ 403/قائمة فارغة، لا 500» · المسبار: 0 رمي | **VERIFIED** (نفس الأدلة) — بانتظار الدمج |

القيد العقدي «لا تغيير في دلالات الأدوار الأخرى» مثبت في الاختبارين (وحدة + HTTP 200 للمنسّق مع غياب الملكية).

---

## F‑20 — `recordAudit(actor.id)` · نتيجة منفصلة · **NOT_VERIFIED / Phase 14** · خارج نطاق PR #8

| البند | المحتوى |
| --- | --- |
| الوصف | `recordAudit()` يكتب `actor_id: actor.id` **بلا تحقق** (`lib/audit/audit.ts:15-16`)؛ المستودع يدمج الحدث كما هو (`lib/persistence/memory.ts:223-226`)؛ `actor_id: string` نوع فقط (`lib/repositories/interfaces.ts:41`). |
| علاقته بـ D‑01 | OPTION B **عمدًا** لا يتحقق من `actor.id` خارج قواعد الهوية ⇒ ممثل بدور صالح وهوية غائبة/تالفة قد يُنفّذ طفرة (مثل `people:create`) **وتُسجَّل بلا فاعل**. هذا حدّ D‑01 لا خطأ فيه: التفويض قرار مصفوفة، وسلامة الفاعل في التدقيق ثابت **تدقيقي** مستقل. |
| العقد المتأثر | `docs/contract-vs3.md` AC 9: «كل admin mutation ينشئ audit event **بفاعل صحيح**» · F‑15 (ثابت «كل طفرة ⇒ AuditEvent»). |
| الوصولية | HTTP: الفاعل `User` من المخزن (`lib/auth/request.ts:19`) — نفس نموذج تهديد F‑01a (JSONB بلا قيود، `postgres.ts` يقرأ `doc as Store`). النواة: `effectiveActor.id = approval.decidedBy ?? actor.id` (`kernel.ts:630`). **لم تُقَس فعليًا** — لا اختبار يحقن هوية تالفة ويفحص الحدث. |
| التصنيف | **NOT_VERIFIED** · **Phase 14** (ثوابت التدقيق — مع F‑15) |
| في PR #8 | **لا تعديل** — لا على `audit.ts` ولا على التدقيق ولا على النوع `AuditActor`. تسجيل فقط في سجل النتائج (`baseline-2026.md` صف F‑20). |
| ما يغلقه لاحقًا (Phase 14) | اختبار ثابت: كل طفرة ⇒ حدث بـ`actor_id` نصي غير فارغ يطابق فاعل الجلسة، عبر HTTP والنواة؛ وقرار منفصل عن مكان الإنفاذ (خدمة/تدقيق) — **ليس** validation عامًا في `can()`. |

---

## الدلتا المدرجة في PR #8 وحدود النطاق

| الملف | التغيير | لماذا هو «متابعة مراجعة لنفس العقد» |
| --- | --- | --- |
| `tests/unit/policy-matrix.test.ts` | +4 اختبارات D‑01 | تثبيت قرار عقد الممثل ضد التراجع في الاتجاهين |
| `lib/authorization/policy.ts` | تعليق JSDoc على `Actor` (لا كود) | العقد يُقرأ عند تعريفه |
| `docs/audit/baseline-2026.md` | صف F‑01 ← مؤشر F‑01a/F‑01b + D‑01 · صف **F‑20** جديد · ملخص NOT_VERIFIED | سجل النتائج هو المرجع الرسمي للتصنيف |
| `docs/audit/pr8-review-followup.md` | هذا الملف | سجل القرار والأدلة |

**ما لم يتغيّر (تحقق `git diff --name-only`):** `package.json` · `package-lock.json` (SHA `ca2e6f5c…` قبل/بعد `npm ci`) · `.env*` · `lib/persistence/**` · `lib/audit/**` · `MATRIX` · `Resource.team_id` (لا عزل فرق) · لا تبعيات · لا تنظيف غير مرتبط.

---

## Phase E — البوابات (exit codes فعلية، على رأس PR #8 + الدلتا)

| الأمر | EXIT | المخرج |
| --- | --- | --- |
| `npm run typecheck` | **0** | `tsc --noEmit` نظيف |
| `npm test` | **0** | 25 ملفًا · **258 ناجح · 8 متخطّى (266)** — كان 229+8 في خط الأساس؛ PR #8 +25؛ D‑01 +4 |
| `npm run build` | **0** | `✓ Compiled successfully` |
| `npm start` ثم `npm run smoke` | **0** | `SMOKE RESULT: 49/49 passed` (بيئة smoke كما في `ci.yml`: سر جلسة + `L27_SEED_DEMO_ACCOUNTS=1` + `L27_DEMO_PASSWORD` محلية + `L27_ALLOWED_HOSTS`) |
| `npm run readme:check` | **0** | `OK README.md` · `OK README.en.md` |
| `npm run readme:drift -- --strict` | **0** | «✅ لا انحراف» — الأدوار 6 · الإجراءات 14 · صفوف المصفوفة مطابقة (6) |
| اختبارات التفويض المركزة (`policy-matrix` + `policy` + `api-field-reports`) | **0** | **47/47** (22 + 10 + 15) — وكانت 43/43 على PR #8 قبل الدلتا |
| مسبار D‑01 (خارج المستودع) | **0** على رأس PR #8 · **1** على ما قبل الإصلاح | جدول المطابقة أعلاه |

الاختبارات المتخطّاة (8) هي فروع Postgres الحيّة (`skipIf(!L27_TEST_DATABASE_URL)`) — تُنفَّذ في CI مع خدمة `postgres:16` (F‑09 كما في خط الأساس).

---

## ما لا يدّعيه هذا الملف

- لا يدّعي خلوّ النظام من الأخطاء؛ يثبت فقط أن PR #8 + الدلتا يطابقان D‑01 ويغلقان F‑01a/F‑01b بأدلة قابلة لإعادة الإنتاج.
- F‑20 **مسجَّل لا مُعالَج**؛ F‑02 (team_id) **قرار مؤجل لا مُنفَّذ**؛ F‑15 كما هو.
- «VERIFIED» هنا = اختبارات محلية EXIT=0 + CI SUCCESS على الرأس **قبل الدمج**؛ الدمج قرار بشري.

## أوامر إعادة الإنتاج

```bash
git fetch origin --prune && gh pr view 8 --json state,mergedAt,mergeCommit,headRefOid
npm ci && npm run typecheck && npm test && npm run build
npm start & BASE_URL=http://127.0.0.1:3000 L27_DEMO_PASSWORD=… npm run smoke
npm run readme:check && npm run readme:drift -- --strict
npx vitest run tests/unit/policy-matrix.test.ts tests/unit/policy.test.ts tests/integration/api-field-reports.test.ts
npx vitest run tests/unit/policy-matrix.test.ts -t "D-01"
git diff --check && git diff --name-only && git diff --stat
```
