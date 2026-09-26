# مخطط الإنجاز والمتبقي حتى النشر المجاني (بدون بطاقة)

> **الهدف:** نشر حيّ ومجاني ودائم **بلا بطاقة ائتمان (فيزا/ماستركارد)** على **Vercel Hobby** + **قاعدة بيانات مجانية (Neon أو Supabase)** — والتسليم لا يُحتسب إنجازًا إلا بتعريف **`DEPLOYED = VERIFIED`**: اختبار الـURL الحيّ فعليًا.
>
> **آخر تحقق محلي:** 2026-09-26 على `4bccedf` — البوابات الست كلها خضراء (الأسفل).

---

## 0. لوحة الحالة في سطر واحد

```text
██████████████████████████████░░░░░░  المنتج: VS1→VS4 منفَّذ · البوابات الست خضراء
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  النشر المجاني: متبقي محوّل PostgreSQL + إعدادات الإنتاج + النشر والتحقق
```

**الحالة الحقيقية:** المنتج مكتمل الوظائف ومضبوط — لكنه **لم يُنشر بعد**، والمانع الحقيقي الوحيد للنشر المجاني الباقي هو **محوّل قاعدة بيانات** (القرص على Vercel serverless مؤقّت — تنويه مُثبَّت في `lib/persistence/file-json.ts`).

---

## 1. المخطط العام

```mermaid
flowchart LR
    subgraph DONE["✅ تم إنجازه"]
        A1[VS1+VS2: الأساس + أشخاص + متطوعون + تقارير\nMERGED في main — PR #1]
        A2[VS3: النواة الإدارية\nحملة/دورات/مناطق/فرق/مستخدمون + session_epoch]
        A3[VS4: النواة الحيّة + الأنوية الذرية\n8 أنوية · hot swap · مَقابض · بوابة موافقة بشرية]
        A4[البوابات الست خضراء\ntypecheck · 166 test · build · 45 smoke · README · CI]
        A5[حقن المخزن عبر Repository Interface\nmemory | file — جاهز لمحوّل ثالث]
    end

    subgraph TODO["⏳ المتبقي حتى النشر المجاني"]
        B1[T1 · محوّل PostgreSQL فوق Repos\n+ schema + seed — المانع الوحيد الحقيقي]
        B2[T2 · سر جلسة إنتاجي\nL27_SESSION_SECRET إلزامي]
        B3[T3 · تقوية الحسابات التجريبية\nتغيير/تعطيل Demo!2345]
        B4[T4 · متغيرات البيئة على المضيف\nDATABASE_URL + L27_STORE=postgres]
    end

    subgraph DEPLOY["🚀 النشر — بلا بطاقة"]
        C1[Vercel Hobby\nاستيراد المستودع من GitHub\n$0 · لا تُدخل بطاقة]
        C2[Neon Free / Supabase Free\nPostgres دائم مجاني — بلا بطاقة]
    end

    subgraph VERIFY["🔎 التحقق = DEPLOYED = VERIFIED"]
        D1["smoke 45/45 ضد BASE_URL=<الرابط الحي>"]
        D2[اختبار بقاء البيانات عبر إعادة Deploy]
        D3[manifest ← DEPLOYED=VERIFIED\nCOMMIT → PUSH → VERIFY_REMOTE]
    end

    A1 --> A2 --> A3 --> A4 --> A5
    A5 --> B1 --> B2 --> B3 --> B4
    B4 --> C2 --> C1
    C1 --> D1 --> D2 --> D3
```

---

## 2. ما تم إنجازه ✅ (بالدليل — «لا ادعاء بلا إثبات»)

| البند | الوصف | الدليل |
| --- | --- | --- |
| **VS1 — الأساس** | Next.js 16 + React 19 + TypeScript، بنية app/api، CI | `PR #1` — مدموج في `main` |
| **VS2 — أشخاص + متطوعون + تقارير** | كيانات كاملة، صلاحيات على الخادم، تدقيق لكل mutation، مؤشرات | `PR #1` — `docs/plan-vs2.md` |
| **VS3 — النواة الإدارية** | الحملة + الدورات + المناطق + الفرق + المستخدمون + `session_epoch` | `docs/contract-vs3.md` (LOCKED) · `docs/plan-vs3.md` |
| **VS4 — النواة الحيّة + الأنوية الذرية** | 8 أنوية مكتفية ذاتيًا، hot swap، مَقابض تعديل، بوابة موافقة بشرية single-use | `docs/kernel.md` |
| **الأمن والجلسات** | cookie موقّع HMAC-SHA256 · scrypt لكلمات المرور · صفر اعتماديات خارجية · `password_hash` لا يظهر أبدًا | `lib/auth/` + اختبارات |
| **التدقيق** | AuditEvent لكل عملية تعديل، وتسجيل اعتمادات الوكلاء وسلطة المُعتمِد | `lib/audit/` + اختبارات |
| **طبقة التخزين القابلة للاستبدال** | `Repository Interface` + محوّلان (memory/file) — **المجال لا يعرف التخزين** | `lib/repositories/interfaces.ts` |
| **CI أخضر** | typecheck + tests + build + smoke على كل push/PR | `.github/workflows/ci.yml` |
| **الوثائق** | `project.manifest.json` مصدر حقيقة واحد · README مولَّد · فحص انحراف | `npm run readme:check` |

### البوابات — مُعاد التحقق منها محليًا 2026-09-26 على `4bccedf`

| البوابة | الأمر | النتيجة |
| --- | --- | --- |
| الأنواع | `npm run typecheck` | ✅ نظيف |
| الاختبارات | `npm test` | ✅ **166/166** (98 + 68 للنواة) |
| البناء | `npm run build` | ✅ PASS — كل الشاشات و`/api/*` |
| Smoke إنتاجي | `npm start` ثم `npm run smoke` | ✅ **45/45** |
| README | `npm run readme:check` | ✅ متزامن مع الـmanifest |
| CI | GitHub Actions | ✅ أخضر |

---

## 3. ما هو متبقي ⏳ (فجوة النشر المجاني)

| # | البند | لماذا هو مطلوب؟ | الحجم |
| --- | --- | --- | --- |
| **T1** | **محوّل PostgreSQL فوق `Repos`** + `schema.sql` + عقد اختبارات persistence على المحوّل الجديد | **المانع الحقيقي الوحيد.** القرص ephemeral على Vercel serverless — وضع `file` سيفقد كل البيانات مع أول إعادة نشر (التنويه مُثبَّت في `lib/persistence/file-json.ts`). المجال (domain) لا يتغيّر إطلاقًا — نفس الواجهة | متوسط |
| **T2** | **سر جلسة إنتاجي** | `L27_SESSION_SECRET` الافتراضي `l27-dev-secret-change-me` غير آمن إطلاقًا للإنتاج | صغير جدًا |
| **T3** | **تقوية الحسابات التجريبية** | كلمات المرور `Demo!2345` seed-only — تغييرها أو تعطيلها قبل أي استخدام حقيقي | صغير |
| **T4** | **متغيرات البيئة على المضيف** | `L27_STORE=postgres` · `DATABASE_URL` · `L27_SESSION_SECRET` | صغير |
| **T5** | **النشر الفعلي** | استيراد المستودع على Vercel Hobby + إنشاء قاعدة Neon — **لا تُدخل بطاقة في أي خطوة** | صغير |
| **T6** | **التحقق الحيّ** | `BASE_URL=https://<app>.vercel.app npm run smoke` ⇒ 45/45 + اختبار بقاء البيانات عبر إعادة Deploy | صغير |
| **T7** (اختياري) | نطاق مخصص · قفل نطاق البريد (`auth.domain`) · نسخ احتياطي دوري `pg_dump` | تحسينات ما بعد النشر | — |

### لماذا لا تكفي «النشر فقط» بدون T1؟

- **Vercel + وضع `file` الحالي:** يعمل ظاهريًا، لكن `var/data/db.json` يُكتب على نظام ملفات ephemeral ⇒ **البيانات تضيع** مع أول إعادة نشر/دفء جديد ⇒ يخالف تعريف `DEPLOYED = VERIFIED`.
- **مضيف VM مجاني (Render/Koyeb free):** أقراصها ephemeral أيضًا وتُجمَّد بعد خمول — تأخير استيقاظ + فقدان بيانات + لا يحلّ شيئًا يحلّه T1.
- **الخلاصة:** المسار الموثوق الوحيد بلا بطاقة = **Vercel Hobby (تطبيق) + Neon/Supabase Free (بيانات)** — وهذا يتطلب T1 فقط من الكود.

---

## 4. مراحل التنفيذ المتبقية (بنفس انضباط «العقد قبل الكود»)

| المرحلة | المخرج | البوابة |
| --- | --- | --- |
| **P0** | تعريف schema الجديد واختيار المزوّد (Neon موصى به: دائم مجاني، scale-to-zero، بلا بطاقة) | قرار موثّق |
| **P1** | `lib/persistence/postgres.ts` فوق نفس `Repos` + `schema.sql` + عقد persistence tests **على المحوّل الجديد** (نفس عقود memory/file) | typecheck + unit خضراء |
| **P2** | تفعيل `L27_STORE=postgres` في `container.ts` + seed أولي (الحسابات الست + الحملة) — وضعا `memory`/`file` **لم يتغيّرا** | الـ166 اختبارًا كما هي + الجديدة خضراء |
| **P3** | إلزامية `L27_SESSION_SECRET` في الإنتاج (رفض التشغيل بالافتراضي) + تغيير/تعطيل كلمات المرور التجريبية | tests + build |
| **P4** | النشر التجريبي: Neon Free ← Vercel Hobby (استيراد من GitHub، بلا بطاقة) + ضبط env | البناء على Vercel أخضر |
| **P5** | `BASE_URL=<الرابط الحي> npm run smoke` ⇒ 45/45 + إنشاء سجل ← إعادة Deploy ← السجل باقٍ ✅ | **DEPLOYED = VERIFIED** |
| **P6** | تحديث `project.manifest.json` (الحالة + env) ← `npm run readme:generate` ← `CHANGE → COMMIT → PUSH → VERIFY_REMOTE` | readme:check + CI أخضر |

---

## 5. خطوات النشر خطوة بخطوة (حرفيًا — بلا بطاقة)

1. **قاعدة البيانات:** أنشئ حسابًا على [neon.com](https://neon.com) (Free plan — لا تُدخل بطاقة) ← مشروع جديد ← انسخ `DATABASE_URL`.
2. **التطبيق:** [vercel.com/new](https://vercel.com/new) ← Sign up with GitHub ← **Hobby** (لا تُضف وسيلة دفع إطلاقًا) ← Import مستودع `sayedelazameydesign-crypto/leader2027`.
3. **متغيرات البيئة على Vercel:**
   | المتغير | القيمة |
   | --- | --- |
   | `L27_STORE` | `postgres` |
   | `DATABASE_URL` | رابط Neon (من الخطوة 1) |
   | `L27_SESSION_SECRET` | قيمة عشوائية 32+ حرفًا — **لا تستخدم الافتراضي أبدًا** |
4. **Deploy** ← انتظر اكتمال البناء (نفس بوابات CI الخضراء).
5. **التحقق:** من الطرفية:
   ```bash
   BASE_URL=https://<your-app>.vercel.app npm run smoke   # المطلوب: 45/45
   ```
6. **اختبار بقاء البيانات:** أنشئ سجلًا من الواجهة ← Trigger Redeploy على Vercel ← السجل **ما زال موجودًا** ✅.
7. **الإغلاق:** حدّث الـmanifest إلى `DEPLOYED = VERIFIED` ← `npm run readme:generate` ← `CHANGE → COMMIT → PUSH → VERIFY_REMOTE` (انظر `docs/sync-verification.md`).

---

## 6. المخاطر والحدود

| الخطر | التخفيف |
| --- | --- |
| شروط Vercel Hobby: **لاستخدام شخصي/غير تجاري** فقط — الاستخدام التجاري يتطلب Pro | راجع شروط [vercel.com/pricing](https://vercel.com/pricing) قبل النشر الرسمي؛ إن كان الاستخدام تجاريًا فالمجاني غير متاح هناك |
| Neon Free: 0.5GB + 100 compute-hour/شهر + scale-to-zero (تأخر أول طلب بعد خمول) | يكفي للتشغيل التجريبي والحملة الصغيرة؛ الترقية المدفوعة لاحقة عند الحاجة |
| Supabase Free: يُجمَّد بعد 7 أيام خمول | استيقاظ يدوي — أو اختر Neon (scale-to-zero بلا تجميد) |
| تغيير `L27_SESSION_SECRET` لاحقًا يُسقط كل الجلسات (HMAC) | اضبطه **قبل** أول استخدام حقيقي |
| الحسابات الست ب`Demo!2345` | T3: تغييرها أو تعطيلها فور أول نشر حقيقي |
| لا نسخ احتياطي تلقائي على الباقات المجانية | `pg_dump` دوري يدويًا أو قاعدة بيانات ثانوية على Supabase |

---

## 7. تعريف الإنجاز (DoD) — النشر المجاني

- [ ] محوّل PostgreSQL خضراء فوق نفس `Repos` — بلا تعديل على domain (T1)
- [ ] البوابات الست + اختبارات المحوّل الجديد خضراء في CI
- [ ] نشر على **Vercel Hobby + Neon Free** — **لم تُدخل بطاقة في أي خطوة**
- [ ] `smoke` **45/45** ضد الـURL الحيّ
- [ ] اختبار بقاء البيانات عبر إعادة نشر = البيانات باقية
- [ ] سر جلسة إنتاجي فريد + الحسابات التجريبية مُقوّاة (T2+T3)
- [ ] `project.manifest.json` ← **DEPLOYED = VERIFIED** + README مُحدَّث + remote SHA موثّق

---

## 8. In English (short)

- **Done:** VS1–VS4 are merged/implemented (people, volunteers, field reports, admin core, live kernel + atomic nuclei with human-approval gate). All six gates verified green locally today at `4bccedf`: typecheck, 166/166 tests, build, 45/45 production smoke, README sync, green CI. Storage sits behind a `Repository Interface` (memory | file) ready for a third adapter.
- **Remaining until a free, cardless deploy:** **(T1)** a PostgreSQL adapter over the same `Repos` interface + schema/seed — the only real blocker (Vercel's serverless disk is ephemeral, documented in `lib/persistence/file-json.ts`); **(T2)** a production `L27_SESSION_SECRET`; **(T3)** hardening the `Demo!2345` seed accounts; **(T4–T6)** env vars on the host, deploy via **Vercel Hobby + Neon/Supabase Free (no credit card anywhere)**, then `BASE_URL=<live> npm run smoke` = 45/45 plus a redeploy data-persistence check.
- **Definition of done:** `DEPLOYED = VERIFIED` only after the live URL has actually been exercised — never on build success alone.
