<!-- ⚠️ ملف مُولَّد آليًا — لا تُعدّله يدويًا -->
<!-- المصدر: project.manifest.json · المولّد: scripts/generate-readme.mjs -->

# Leader 2027

> منصة تشغيل وإدارة للحملة الانتخابية: أشخاص (وعي بالمصدر)، متطوعون، عمل ميداني، تقارير، مؤشرات تشغيلية — في لوحة قيادة واحدة. **بلا أي تفضيلات سياسية** (عقد المنتج §5).

**v0.1.0** · **MIT** · **Node 22+** · [English](README.en.md)

## الحالة

**VS4** — VS1+VS2 = **MERGED في main (PR #1)** · VS3 (نواة الحملة الإدارية) = **منفَّذ — بوابات خضراء** · VS4 (النواة الحيّة + الأنوية الذرية) = **منفَّذ — بوابات خضراء**.

| الشريحة | الوصف | الحالة | الدليل |
| --- | --- | --- | --- |
| **VS1** | الأساس | مدموج | `PR #1` |
| **VS2** | أشخاص + متطوعون + تقارير ميدانية | مدموج | `PR #1` |
| **VS3** | نواة الحملة الإدارية | منفَّذ | `docs/contract-vs3.md` |
| **VS4** | النواة الحيّة + الأنوية الذرية | منفَّذ | `docs/kernel.md` |

## المبادئ الملزمة

- **§5 محظور مطلقًا:** لا انتماء سياسي ولا «درجة إقناع» ولا استنتاجها آليًا — أي payload يحملها يُرفض صراحةً.
- **بلا إخفاء أزرار كـauthorization:** الصلاحيات تُفرض على الخادم (policy + service + API)، وإخفاء الـUI تحسين تجربة فقط.
- **العقد قبل الكود:** كل شريحة تُقفل بعقد (`docs/contract-*.md`) قبل سطر تنفيذ واحد.
- **لا ادعاء بلا إثبات:** كل بند مقبول له ملف دليل (اختبار/فحص smoke/سجل).
- **العزل قبل الذكاء:** كل قدرة ذكاء اصطناعي تمرّ ببوابة موافقة بشرية مُدقَّقة، وبلا استيراد بين الأنوية.

## التشغيل

```bash
npm ci
```

| الأمر | الوصف |
| --- | --- |
| `npm run dev` | تطوير على http://localhost:3000 |
| `npm run build` | بناء إنتاجي |
| `npm run start` | إنتاج على 0.0.0.0:3000 |
| `npm run test` | 166 unit/integration (98 قائمة + 68 للنواة) |
| `npm run smoke` | 45 فحص production ضد خادم قائم (`BASE_URL` اختياري) |
| `npm run typecheck` | فحص TypeScript بلا إخراج |
| `npm run readme:generate` | توليد README من الـmanifest |
| `npm run readme:check` | كشف انحراف README عن الـmanifest |
| `npm run readme:drift` | فحص استشاري: الـmanifest مقابل الكود (تحذيرات فقط) |

## حسابات تشغيلية تجريبية (seed-only)

| البريد | الدور | المستوى |
| --- | --- | --- |
| `owner@leader2027.test` | المالك — `OWNER` | إداري |
| `admin@leader2027.test` | مدير النظام — `CAMPAIGN_ADMIN` | إداري |
| `manager@leader2027.test` | مدير الحملة — `CAMPAIGN_MANAGER` | إداري |
| `coordinator@leader2027.test` | منسق ميداني — `FIELD_COORDINATOR` | ميداني |
| `worker@leader2027.test` | عامل ميداني — `FIELD_WORKER` | ميداني |
| `viewer@leader2027.test` | مُطلع — `VIEWER` | قراءة فقط |

كلمة المرور للكل: `Demo!2345` — بيانات تشغيلية تجريبية (seed-only) وليست إنتاجية.

## مصفوفة الصلاحيات

| الإجراء | `OWNER` | `CAMPAIGN_ADMIN` | `CAMPAIGN_MANAGER` | `FIELD_COORDINATOR` | `FIELD_WORKER` | `VIEWER` |
| --- | --- | --- | --- | --- | --- | --- |
| لوحة القيادة — `dashboard:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| عرض الأشخاص — `people:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إنشاء شخص — `people:create` | ✅ | ✅ | ✅ | ✅ | — | — |
| تعديل شخص — `people:update` | ✅ | ✅ | ✅ | ✅ | — | — |
| عرض المتطوعين — `volunteers:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إنشاء متطوع — `volunteers:create` | ✅ | ✅ | ✅ | ✅ | — | — |
| تعديل متطوع — `volunteers:update` | ✅ | ✅ | ✅ | ✅ | — | — |
| عرض التقارير — `reports:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إنشاء تقرير — `reports:create` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| تعديل ملاحظات — `reports:update_notes` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| تعديل حالة — `reports:update_status` | ✅ | ✅ | ✅ | ✅ | — | — |
| إدارة المستخدمين — `users:manage` | ✅ | ✅ | ✅ | — | — | — |
| إدارة الإعدادات — `settings:manage` | ✅ | ✅ | ✅ | — | — | — |
| عرض التدقيق — `audit:view` | ✅ | ✅ | ✅ | ✅ | — | — |

### قواعد الجلسة

- تغيير الدور يُسقط كل الجلسات السابقة فورًا (`session_epoch`) — تغيير الاسم/الفريق لا يطرد الجلسات.
- البريد وكلمة المرور غير قابلين للتعديل في v1.
- الجلسة = cookie موقّع HMAC-SHA256، وكلمات المرور scrypt (`node:crypto`) — صفر اعتماديات خارجية.

## واجهات API

| الطريقة | المسار | ملاحظة |
| --- | --- | --- |
| `POST` | `/api/auth/login` | الدخول (cookie موقّع) |
| `POST` | `/api/auth/logout` | الخروج |
| `GET` | `/api/health` | فحص الصحة (بلا مصادقة) |
| `GET/POST` | `/api/people` | قائمة / إنشاء |
| `GET/PATCH` | `/api/people/:id` | قراءة / تعديل |
| `GET/POST` | `/api/volunteers` | قائمة / إنشاء |
| `GET/PATCH` | `/api/volunteers/:id` | قراءة / تعديل الحالة |
| `GET/POST` | `/api/field/reports` | قائمة / إنشاء |
| `GET/PATCH` | `/api/field/reports/:id` | قراءة / ملاحظات+حالة |
| `GET` | `/api/stats` | المؤشرات التشغيلية |
| `GET/PATCH` | `/api/campaign` | الحملة (settings:manage) |
| `GET/POST` | `/api/cycles` | الدورات الانتخابية |
| `PATCH` | `/api/cycles/:id` | تعديل دورة |
| `GET/POST` | `/api/regions` | المناطق |
| `GET/POST` | `/api/teams` | الفرق |
| `GET/POST` | `/api/users` | المستخدمون (users:manage) |
| `PATCH` | `/api/users/:id` | اسم/دور/فريق/منطقة — البريد وكلمة المرور غير قابلين للتعديل في v1 |
| `GET/PATCH` | `/api/kernel` | الصورة الحيّة للأنوية / تعديل مَقابض نواة (settings:manage) |
| `GET` | `/api/kernel/cells` | كتالوج الأنوية والأدوات للوكلاء |
| `POST` | `/api/kernel/actions` | تنفيذ أداة / اعتماد أو رفض موافقة |

كل mutation ينشئ AuditEvent · `password_hash` لا يظهر في أي استجابة.

## الشاشات

- `/` لوحة القيادة · `/people` + `/people/[id]` · `/volunteers` + `/volunteers/[id]`
- `/field/reports` + `/field/reports/new` + `/field/reports/[id]` · `/login`
- `/admin` (الحملة/الدورات/المناطق/الفرق) · `/admin/users` — كلها خلف حدود المصادقة
- `/kernel` — النواة الحيّة: الأركان، مَقابضها، وطابور الموافقات البشرية

## البنية

```text
app/          الصفحات + API + globals.css + layout
components/   admin / dashboard / field / people / volunteers / ui
lib/          domain / repositories / persistence / auth / authorization / audit / validation
scripts/      توليد الوثائق + فحص الانحراف
docs/         العقود والخطط وسجل المزامنة
tests/        unit / integration / smoke
```

| المسار | المحتوى |
| --- | --- |
| `app/(app)/` | لوحة قيادة، أشخاص، متطوعون، تقارير، إدارة — خلف حدود المصادقة |
| `app/login/` | الدخول |
| `lib/kernel/` | النواة: العقود، الـmanifest، الناقل، الموافقات، النواة، جذر التركيب |
| `lib/cells/` | الأنوية الذرية الثمانية — ركن لكل نواة، معزولة ومستقلة |
| `app/api/` | people / volunteers / field/reports / stats / auth / campaign / cycles / regions / teams / users / health |
| `lib/domain/` | قواعد الكيانات + services — people/volunteers/field/stats/dashboard/settings/users |
| `lib/repositories/` | واجهات المخزن (Domain → Repository Interface → Persistence Adapter) |
| `lib/persistence/` | InMemory + FileJson — PostgreSQL لاحقًا بلا إعادة كتابة domain |
| `lib/auth+authorization+audit+validation` | جلسات HMAC، مصفوفة 6 أدوار، تدقيق لكل mutation، رفض §5 |
| `scripts/` | توليد الوثائق من `project.manifest.json` + فحص الانحراف |
| `tests/` | unit + integration + smoke (يُشغَّل في CI ضد next start) |
| `project.manifest.json` | **مصدر الحقيقة الوحيد** — README مُولَّد منه |

## المتغيرات البيئية

| المتغير | القيم | الافتراضي | ملاحظة |
| --- | --- | --- | --- |
| `L27_STORE` | memory \| file | `file` | نوع المخزن |
| `L27_DB_PATH` | path | `var/data/db.json` | مسار ملف البيانات (وضع file) |
| `L27_SESSION_SECRET` | secret | `l27-dev-secret-change-me` | سرّ توقيع الجلسة — **بدّله في الإنتاج** |

## بوابات الجودة

| البوابة | الأمر | المتوقع |
| --- | --- | --- |
| `typecheck` | `npm run typecheck` | **clean** |
| `tests` | `npm test` | **166/166** |
| `build` | `npm run build` | **PASS** |
| `smoke` | `npm run smoke` | **45/45** |
| `ci` | `GitHub Actions` | **PASS** |

CI يشغّل هذه البوابات كلها على كل push/PR — انظر [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## النشر على Vercel

- جاهز لـ Vercel (Next.js قياسي + lockfile + CI أخضر). النشر يتطلب ربط حسابك على [vercel.com/new](https://vercel.com/new) واستيراد المستودع — أو `npx vercel`.
- **تنويه مُثبَّت:** القرص ephemeral على Vercel serverless — محوّل PostgreSQL لاحقًا فوق نفس الواجهة (`Repository Interface`) بلا إعادة كتابة domain (TODO موثّق في `lib/persistence/file-json.ts`).
- النشر = **DEPLOYED = VERIFIED** فقط بعد اختبار الـURL الحي فعليًا.
- **المسار المجاني بدون بطاقة (Vercel Hobby + Neon/Supabase Free):** خطواته وفجواته المتبقية موثّقة في [`docs/deploy-free-roadmap.md`](docs/deploy-free-roadmap.md).

## المزامنة مع GitHub

[`docs/sync-verification.md`](docs/sync-verification.md)

- لا commit قبل تغيير مقصود + بوابات خضراء.
- الدمج بإثبات `mergedAt ≠ null`.
- الدورة المثبتة: `CHANGE → COMMIT → PUSH → VERIFY_REMOTE`.

## الوثائق

| الملف | المحتوى |
| --- | --- |
| [`docs/contract-vs3.md`](docs/contract-vs3.md) | عقد VS3 (LOCKED) |
| [`docs/plan-vs2.md`](docs/plan-vs2.md) | خطة VS2 كما نُفِّذت |
| [`docs/plan-vs3.md`](docs/plan-vs3.md) | خطة VS3 كما نُفِّذت |
| [`docs/sync-verification.md`](docs/sync-verification.md) | توثيق التحقق من المزامنة |
| [`docs/readme-generation.md`](docs/readme-generation.md) | كيف يُولَّد هذا الملف |
| [`docs/kernel.md`](docs/kernel.md) | معمارية النواة الحيّة والأنوية الذرية |
| [`docs/deploy-free-roadmap.md`](docs/deploy-free-roadmap.md) | مخطط الإنجاز والمتبقي حتى النشر المجاني (بدون بطاقة) |
| [`docs/idea-trusted-agent-computer.md`](docs/idea-trusted-agent-computer.md) | فكرة: الجهاز الوكيلي الموثوق — كيف نتفوق على Manus في الثقة لا الاستقلالية |

## خارج النطاق (صراحة)

- ❌ تعديل بريد/كلمة مرور المستخدم (v2)
- ❌ حذف الكيانات
- ❌ `VoterRecord` وبقية بنود §13
- ❌ أي UI لـ Assign Task (P3)
- ❌ أي حقل تفضيل سياسي — محظور نهائيًا (§5)

## كيف يُولَّد هذا الملف

هذا الـREADME **ناتج مشتق (Derived Artifact)** لا يُعدَّل يدويًا:

```text
project.manifest.json  (مصدر الحقيقة الوحيد)
        │
        ├── npm run readme:generate  →  README.md + README.en.md
        ├── npm run readme:check     →  كشف الانحراف عن الـmanifest
        └── npm run readme:drift     →  فحص استشاري: الـmanifest مقابل الكود
```

```bash
npm run readme:generate   # عدّل الـmanifest ثم ولّد
npm run readme:check      # يفشل إن كان الـREADME قديمًا
```
**مستقل عن الـbuild:** فشل توليد الـREADME **لا يفشل** بناء النظام ولا اختباراته —
في CI يعمل التوليد كخطوة استشارية (`continue-on-error`) تُصدِر تحذيرًا فقط.
