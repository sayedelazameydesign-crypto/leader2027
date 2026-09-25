# خطة P1 (بقية) + P2 — حاوية CI المعزولة + الإقلاع fail-closed

**الحالة: LOCKED قبل التنفيذ.** السياق: بعد P0 (دمج VS3 في `main` عند `7916b20` — PR #2،
`mergedAt = 2026-09-25T22:31:03Z`، CI على `main` = run `36197087584` نجاح).

لا توسيع نطاق: بلا كيانات جديدة، بلا شاشات جديدة، بلا §13، وبلا تغيير في مصفوفة §4.

## P1 — «CI container» (التفسير المُقفل)

**المشكلة المُثبتة في CI الحالي:** خطوة الـsmoke تُشغّل `next start` بلا `L27_DB_PATH`،
فيكتب الخادم في `var/data/db.json` داخل شجرة العمل، والـsmoke يُغيّر الحالة
(إنشاء مستخدمين/دورات/مناطق). أي إعادة تشغيل على نفس الـrunner أو أي فحص يعتمد
«العدد قبل/بعد» يصبح غير حتمي. الحاوية (مخزن البيانات) ليست معزولة ولا طازجة.

**القرار:** كل تشغيل CI يحصل على **حاوية بيانات طازجة ومعزولة**:

```yaml
env:
  L27_DB_PATH: ${{ runner.temp }}/l27-ci/db.json   # خارج شجرة العمل
  L27_CI_RUN: ${{ github.run_id }}-${{ github.run_number }}
```

+ **حتمية مثبتة لا مفترضة:** الـsmoke يُنفَّذ مرتين ضد نفس الخادم ونفس الحاوية
(31+31 فحصاً) — لو كان أي فحص يعتمد حالة أول تشغيل لسقط الثاني.

+ **اختبارات حاوية DI** (`tests/unit/container.test.ts`):
  1. `setRepos(null)` بعد حقن ← يعود للحقيقة البيئية (لا التصاق للـoverride).
  2. `L27_STORE=memory` ← كاش singleton (نفس المرجع مرتين).
  3. `L27_STORE=file` ← **مخزن طازج من القرص في كل استدعاء** (الكائن مختلف،
     والكتابة عبر حاوية تظهر فوراً في حاوية أخرى) — وهو الثابت الذي فرضته بوابة
     smoke في VS2 (عوالم module غير مشتركة في `next start`).

+ **smoke:** فحصا إثبات (32، 33) — أن حاوية البيانات في `L27_DB_PATH` كُتبت فعلاً
  (ملف موجود وحجمه > 0)، وأن `L27_CI_RUN` (إن وُجد) ظهر في سجل الخادم
  (`/tmp/leader2027-server.log`) ⇒ إثبات أن الخادم استهلك نفس الحاوية المعزولة.

## P2 — «startup fail-closed»

**المشكلة المُثبتة:** `lib/auth/session.ts` كان يوقّع الجلسات بـ
`process.env.L27_SESSION_SECRET ?? "l27-dev-secret-change-me"` — سرّ ثابت مكشوف في
المستودع. على الإنتاج هذا يعني: أي طرف يقرأ المصدر يستطيع تزوير cookie جلسة لأي
مستخدم (بما فيه OWNER). إقلاع ناجح + ثغرة = **فشل مفتوح** (fail-open).

**القرار:** الإقلاع على الإنتاج **يرفض العمل** بلا سرّ صريح كافٍ:

```text
resolveSessionSecret(nodeEnv, raw):
  production → raw غير معرّف/فارغ/أقصر من 16 حرفاً/يساوي سرّ التطوير ← throw (رسالة إصلاح عربية)
  غير production ← DEV_SESSION_SECRET (سلوك التطوير والاختبارات بلا تغيير)
```

- التحقّق عند **أول استخدام** (lazy) لا عند تحميل الـmodule ⇒ رسائل خطأ واضحة،
  وبلا كسر `next build` (جمعRoute modules) أو الاختبارات.
- الاختبار على الإنتاج **مُثبَّت في CI نفسه**: خطوة «fail-closed proof» تُشغّل
  `next start` بلا `L27_SESSION_SECRET` وتتوقع **خروجاً ≠ 0** ورسالة الرفض في السجل،
  ثم تتوقع نجاح الإقلاع عند تقديم سرّ صالح. هذا يحول القاعدة من نص في README إلى
  سلوك مُختبَر (نفس عرف `docs/sync-verification.md`).
- `.env.example` يُضاف (مسموح في `.gitignore` عبر `!.env.example`) — **لا أسرار حقيقية**.

## Acceptance Criteria

```text
[x] 1  P2: resolveSessionSecret ترفض في production (مفقود/قصير/فارغ/سرّ التطوير) — unit
[x] 2  P2: تقبل سراً صالحاً (≥16) في production، وتسقط لـDEV في development/test — unit
[x] 3  P2: توقيع/قراءة التوكن يعملان بالسر المحلول (بلا انحدار في 98 اختباراً) — unit
[x] 4  P2: CI يُثبت أن next start يفشل بلا سرّ (exit≠0 + الرسالة) وينجح مع سرّ — CI step
[x] 5  P1: CI يستخدم حاوية معزولة في runner.temp (خارج شجرة العمل) — CI env
[x] 6  P1: smoke يُنفَّذ مرتين على نفس الحاوية = 31+31 PASS (حتمية) — CI step
[x] 7  P1: smoke يُثبت أن الحاوية كُتبت فعلاً (فحص 32) وأن run-id ظهر في سجل الخادم (فحص 33)
[x] 8  P1: container unit tests (override/memory-cached/file-fresh) خضراء
[x] 9  typecheck PASS  [x] 10 tests PASS — 130/130  [x] 11 build PASS
[x] 12 production smoke PASS محلياً مع NODE_ENV=production + سرّ صريح — 34/34 × جولتان
[ ] 13 CI PASS على الفرع وعلى main
[ ] 14 remote SHA verified (CHANGE→COMMIT→PUSH→VERIFY_REMOTE)
```

## As-built — ما نُفِّذ فعلياً (وفروق مُقاسة عن الخطة أعلاه)

### 1) P2 لم يكفِ فيها الرفض lazy — قِيست الحقيقة ثم صُحِّح التصميم

الخطة قالت «التحقق عند أول استخدام». **القياس دحضها:** `next start` على
`NODE_ENV=production` بلا سرّ أقلع فعلاً (`✓ Ready in 179ms`) وخدم `/api/health` = 200،
لأن `/api/stats` يرد 401 **قبل** أي توقيع (لا cookie ⇒ لا `sign()`). أي أن الرفض lazy
كان سيبقى فشلاً جزئياً غامضاً (500 عند أول جلسة) لا إقلاعاً fail-closed.

المنفَّذ: **بوابة إقلاع** في `next.config.mjs` (يُحمَّل في عملية الخادم نفسها —
`✓ Running next.config.mjs`) ← `assertBootEnvironment()` من `lib/runtime/config.mjs`
(ESM خام + `config.d.mts` للأنواع) — والرفض lazy في `lib/auth/session.ts` باقٍ كطبقة ثانية.

النتيجة المُقاسة محلياً:

```text
$ env -u L27_SESSION_SECRET NODE_ENV=production PORT=3100 npm start
⨯ Failed to load next.config.mjs …
Error: رفض الإقلاع (fail-closed): L27_SESSION_SECRET غير معرّف — …
start_exit=1   ·   لا منفذ مفتوح على 3100   ·   grep "fail-closed" = 1
$ NODE_ENV=production npm run build   → build_exit=0  (مستثنى صراحةً)
```

### 2) `detectBootCommand` — لا فحص ساذج للنص

الفحص الأول `argv.some(a => a.includes("next start"))` **لا يطابق شيئاً**: argv الحقيقي
`[node, …/.bin/next, "start", "-H", "0.0.0.0"]` (كلمتان منفصلتان). استُبدل باستنتاج
ثلاثي (argv · `npm_lifecycle_script/event` · `process.title`) — والقيم مُقاسة على
Next 16.3.6 ومُثبَّتة في `tests/unit/runtime-config.test.ts` (14 فحصاً)، بما فيها
عمال `jest-worker` أثناء البناء (argv مختلف كلياً ⇒ لا تُطبق البوابة عليهم).

### 3) مصدر واحد للقاعدة

`sessionSecretIssue / sessionSecretMessage / resolveSessionSecret` في `lib/runtime/config.mjs`؛
`lib/auth/session.ts` يستوردها ويعيد تصديرها (اختبار «لا انحراف بين الطبقتين» يقارن
المراجع نفسها: `expect(sessionFromAuth.resolveSessionSecret).toBe(resolveSessionSecret)`).

### 4) P1 — أرقام مُقاسة

```text
CI:  L27_DB_PATH = ${{ runner.temp }}/l27-ci/db.json   (خارج شجرة العمل)
     L27_CI_RUN  = run_id-run_number-sha               (يُطبع في سجل الخادم)
smoke: 31 → 34 فحصاً (P1-32 حاوية مكتوبة، P1-33 مطابقة run-id في السجل،
       P2-34 cookie موقّع بسرّ التطوير المكشوف ← 401)
إعادة إنتاج محلية كاملة لخطوات CI:
     الحاوية طازجة (لا db.json قبل الإقلاع) ✓
     الجولة الأولى 34/34 ✓  ·  الجولة الثانية على نفس الحاوية 34/34 ✓ (حتمية)
     الحاوية مكتوبة: 13943 bytes ← 21922 bytes ✓
```

### 5) اختبار كشف انحرافاً مقصوداً في السلوك القائم (لم يُصلَح — وُثِّق)

`tests/unit/container.test.ts` سقط أولاً لأن `create()` في المحوّلَين **يتجاهل**
`id` المُدخل ويولّد `randomUUID()` (الواجهة `Omit<Region,"id">` أصلاً). لم يُغيَّر
السلوك (خارج نطاق P1) — صُحِّح الاختبار ليُثبت السلوك القائم ويُسجّله تعليقاً.

### 6) بوابات محلية (مُقاسة في هذه الجلسة، قبل الدفع)

```text
npm run typecheck  → 0
npm test           → 130/130 (16 ملفاً)
npm run build      → 0   (وكذلك NODE_ENV=production npm run build → 0)
npm start (production + سرّ صريح + حاوية معزولة) + npm run smoke × 2 → 34/34 + 34/34
P2 fail-closed على خادم حقيقي → exit 1 + الرسالة + لا منفذ
```

### 7) CI — فشل ترجمة مُقاس ثم تصحيح (لا تخمين)

أول دفع لهذه الخطة أنتج تشغيل CI فاشلاً **بلا أي job** (مدة 0s) — ورسالة GitHub
(من صفحة التشغيل نفسها، إذ لا jobs ولا annotations ولا log):

```text
Invalid workflow file: .github/workflows/ci.yml#L1
(Line: 14, Col: 20): Unrecognized named-value: 'runner'.
Located at position 1 within expression: runner.temp
```

السبب: سياق `runner` **غير متاح في `env` على مستوى الوظيفة** — يُقبل في مستوى
الخطوة فقط (`github`/`vars`/`secrets` تُقبل في الاثنين). التصحيح: `L27_DB_PATH`
انتقل إلى `env` خطوة الـsmoke (`${{ runner.temp }}/l27-ci/db.json`)، وبقي
`L27_CI_RUN` (سياق `github`) على مستوى الوظيفة لأن الخطوتين تحتاجانه.

الدرس المُثبَّت: «CI PASS» بند يُقاس — وفشل الترجمة لا يظهر في `gh run view --log`
(لا سجل) ولا في `gh pr checks` («no checks reported»)؛ مصدره صفحة التشغيل
(`Invalid workflow file` + السطر/العمود).

### 8) CI — `NODE_ENV=production` على مستوى الوظيفة يكسر سلسلة الأدوات (مُقاس)

بعد تصحيح §7 تقلّع CI فعلاً (jobs أُنشئت) وسقطت خطوة `npm run typecheck` في ~2s.
التشخيص من annotations (السجلات نفسها تعذّر تنزيلها — EOF من blob storage):

```text
app/(app)/admin/page.tsx#L18  Could not find a declaration file for module 'react/jsx-runtime'
app/(app)/admin/page.tsx#L19+ JSX element implicitly has type 'any' because no interface
                              'JSX.IntrinsicElements' exists
```

أي أن `@types/react` **غير مثبّت** في الـrunner. أُعيد الإنتاج محلياً حرفياً:

```text
$ NODE_ENV=production npm ci      → added 27 packages   (بدلاً من الشجرة الكاملة)
$ NODE_ENV=production npm run typecheck → sh: 1: tsc: not found
```

فالسبب: `NODE_ENV=production` معرَّف في `env` الوظيفة ⇒ يُورَّث إلى `npm ci` و`npm test`
و`npm run build` ⇒ تثبيت/أدوات بنمط إنتاجي بلا devDependencies.

التصحيح: `NODE_ENV=production` (+ `L27_SESSION_SECRET`) في **خطوتَي الخادم فقط**
(fail-closed proof · production smoke) — خطوات `npm ci/typecheck/test/build` بلا NODE_ENV.
النتيجة: نفس دلالة P2 (بوابة الإقلاع تُختبر على خادم production حقيقي) بلا كسر الأدوات.

**قاعدة عامة تُضاف لقواعد الإثبات:** متغيرات البيئة التي تغيّر سلوك سلسلة الأدوات
(NODE_ENV خصوصاً) لا تُوضع على مستوى الوظيفة — تُوضع في الخطوة التي تحتاجها فعلاً.


## خارجه (صراحة)

Vercel (**BLOCKED** — بلا اعتماد/وصول؛ لا يُقدَّم VERIFIED قط) · PostgreSQL adapter ·
VoterRecord · Assign Task (P3) · VS4 Contract (WAITING) · أي §13.
