# خطة P1 — التوحيد والاستفادة من المستودع (DRAFT للاعتماد)

> **الحالة:** DRAFT — قرارات مقترحة بأدلة، بانتظار تأكيد المالك قبل أي نقل كود.
> **السبب:** 9 فروع `arena/*` نشطة/متبقية + ريبوثان خارجيان — والفرع النشط (`01a0e1ab`) ليس الوحيد الذي بنى "سياسة + مهام".

---

## 0. الخلاصة التنفيذية

- **المصدر الوحيد المعتمد:** خط `lib/*` على `arena/01a0e1ab-leader2027` (GEN-3/GEN-4/V5.3) — متكامل مع التطبيق، متعاقد عليه، 346/346 + 58/58.
- **شجرة `celia/` على `01a0e068`: تُؤرشَف ولا تُدمَج** — تتعارض مع قرار مؤقَّفل (`persistence=repos` يرفض SQLite منفصلًا)، ومستقلة عمدًا عن التطبيق (`AISA_RUNTIME_INTEGRATION = NOT_PRESENT`)، وبلا تكامل manifest.
- **يُنقَل فقط:** (1) تقوية أمنية صغيرة من `01a0e01a` (فحص أسرار + إزالة تلميحات)، (2) اختبار المصفوفة الكامل من `01a0e000` بعد تكييفه (14→16 إجراءً)، (3) نمط دليل AIsa الخارجي كـ**مرجع** لبوابة الإنتاج P4 (لا كود).
- **4 فروع محتواها مندمج بالكامل** (صفر ملفات فريدة) — تُحذَف بعد التوثيق.
- **القاعدة الذهبية:** الدمج النصي النظيف ≠ الدمج الدلالي — `01a0e068` يندمج نصيًا بصفر تعارض (0 مسارات مشتركة) لكنه يزرع نظامين متوازيين. **ممنوع الدمج الأعمى.**

---

## 1. الجرد المتحقق (بالشواهد)

`main` عند `3548d58` (merge #7) — وهو نفس `merge-base` الفرعين المتنافسين.

| الفرع | آخر commit | CI | ملفات فريدة عن `main` خارج مساراتنا | الحكم |
|---|---|---|---|---|
| `01a0e1ab` (نحن) | `dabc3fc` | ✅ أخضر (5 تشغيلات) | 46 (GEN-3/GEN-4/V5.3/مخطط) | **السجل** |
| `01a0e068` | `96ec6f9` (نشط قبل ساعة) | ✅ أخضر (10 تشغيلات: CI + AIsa evidence) | 60 (`celia/`‏ 44 + اختبارات 9 + workflows ‏4) | أرشفة + إنقاذ انتقائي |
| `01a0e01a` | `000db9e` (اليوم) | — | 9 (أمن: فحص أسرار + إزالة تلميحات + drift) | **نقل** |
| `01a0e000` | `2ccef6d` | — | 4 (تدقيق PR#8 + اختبار مصفوفة 84 حالة) | **نقل مكيَّف** |
| `01a0dfbf` | `570376c` | — | 2 (نفس اختبارات المصفوفة — مغطاة بـ`01a0e000`) | حذف بعد النقل |
| `01a0da49` / `01a0daaa` / `01a0dc54` / `01a0de28` | سبتمبر 25–26 | — | **0** (مندمجة squash في `main` — عدّادات الـcommits مضللة) | حذف بعد التوثيق |

**المنهج (قابل لإعادة التشغيل):**
```bash
git diff --name-only main...origin/arena/<BR>-leader2027 | sort > /tmp/br.txt
git diff --name-only main..HEAD | sort > /tmp/ours.txt
comm -23 /tmp/br.txt /tmp/ours.txt   # الفريد فعلًا خارج مساراتنا
```
**درس مثبَّت:** عدّ `rev-list` يكذب مع squash-merges (أظهر 10–34 commit "فريدة" لما هو مندمج محتوى). الفرز **بالمحتوى** لا بالعدّ.

---

## 2. التحليل

### 2.1 لماذا `lib/*` يبقى (لا `celia/`)

| المعيار | خط `lib/*` (نحن) | خط `celia/` (`01a0e068`) |
|---|---|---|
| قرار الحفظ المؤقفل (`persistence=repos`) | ✅ يوسّع الـStore | ❌ SQLite منفصل (`node:sqlite`) — **مرفوض صراحة من المالك** |
| التكامل مع التطبيق | ✅ مسارات + جلسات + smoke حي | ❌ مستقل عمدًا (`NOT_PRESENT`) + `package.json` خاص بلا تبعيات |
| العقود | ✅ GEN-3/GEN-4/V5.3 مُقفَلة + بوابات | 1 spec + README (بلا بوابات مكافئة) |
| الاختبارات | 346 (وحدة/تكامل/موزع/مسارات) + 58 smoke | 8 ملفات وحدة (خضراء، لكن بلا HTTP/smoke/drift) |
| الـmanifest | ✅ مدمج + drift نظيف | ❌ untouched (يمر لأنه لا يلمس `app/api` ولا `lib/cells`) |
| NEXA §1–§3 | ✅ مؤقفل في `lib/authorization` | متقارب دلاليًا (`NEXA_E_AVAILABILITY_UNKNOWN`…) لكن **شكل مختلف** — توحيدهما = إعادة كتابة |

### 2.2 ما يُنقَذ من `01a0e068` (مرجع لا كود)

1. **نمط الدليل الخارجي AIsa** (الأصل الوحيد الفريد): `propose → gate → evidence` قراءة-فقط ضد MCP خارجي حقيقي، السر في Actions secrets، والدليل ASCII منقّح — يُستخدَم **قالبًا** لبوابة P4 على مضيفنا (لا يُستورَد `celia/adapters`).
2. **مفردات NEXA الموسعة** (`NEXA_E_*/A_*/I_*` + ميزانية/خصوصية/محاكاة): **مرجع تصميمي** لتشديد السياسة بعد فك تجميد RBAC — §1–§3 تبقى مؤقفلة كما هي.
3. **`t4-prod-evidence.yml`**: يُقيَّم في P4 (يستهدف حماية نشر Vercel — قد يُعاد استخدامه حرفيًا إن تطابق الهدف).

### 2.3 ما يُنقَل من الفروع الصغيرة

| من | ماذا | كيف |
|---|---|---|
| `01a0e01a` | `application-credential-scan.test.ts` (فحص أسرار على `app/components/lib`) | نقل حرفي — مستقل صفري التعارض، ثم تشغيله (متوقع أخضر) |
| `01a0e01a` | إزالة تلميحات بيانات العرض (login/`.env.example`/roadmap) | cherry-pick + مراجعة بشرية سريعة |
| `01a0e01a` | تعديل drift (seed emails ← roles) + `generate-readme` | **كوحدة واحدة** مع تغيير `manifest.roles` + regen + drift — بوابات كاملة |
| `01a0e000` | `policy-matrix.test.ts` (84 حالة تغلق F-01a/F-01b) | **تكييف إلزامي**: 14←16 إجراءً (أُضيف `tasks:*` بعده) + تحديث التوقعات، ثم نقل |
| `01a0e000` | `docs/audit/pr8-review-followup.md` + baseline | نقل كتاريخ تدقيق (وثائق فقط) |

---

## 3. الترتيب (بالأوامر)

### خطوة 0 — تنسيق التجميد (قبل أي كود)
`01a0e068` دُفِع قبل ساعة — غالبًا جلسة عاملة **الآن**. المالك يوقفها/يحوّلها أولًا. لا tag ولا حذف قبل التأكيد.

### خطوة 1 — خطنا إلى `main` (نظيف اليوم)
```bash
gh pr create --base main --head arena/01a0e1ab-leader2027 --title "GEN-3/GEN-4/V5.3: task engine + workers + HTTP orchestrator"
gh pr merge --merge   # دمج حقيقي (لا squash) — يحفظ التاريخ ويمنع تضخم "الفريد" مستقبلًا
```
- 46 مسارًا، صفر تقاطع مع أي فرع آخر، CI أخضر 5/5.

### خطوة 2 — الأمن (`01a0e01a`) ثم المصفوفة (`01a0e000`)
- كل نقل = فرع صغير + cherry-pick/adapt + (typecheck/tests/build/smoke/drift) + PR مستقل.
- ترتيب إجباري: الأمن أولًا (يمس الـmanifest والـdrift)، ثم المصفوفة.

### خطوة 3 — الأرشفة والتنظيف
```bash
git tag archive/celia-gen0-3 96ec6f9 && git push origin archive/celia-gen0-3
# بعد التأكيد: حذف المحتوى-المندمج
git push origin --delete arena/01a0da49-leader2027 arena/01a0daaa-leader2027 arena/01a0dc54-leader2027 arena/01a0de28-leader2027 arena/01a0dfbf-leader2027
# 01a0e068 يبقى قراءة-فقط حتى قرار P4 (t4-prod-evidence) ثم يُحذَف
```

### خطوة 4 — الخارجي (لاحق P1)
- `new-new`: راكد منذ 17 أغسطس — أرشفة/تحويل للسجل بعد نسخ أي مادة مرجعية.
- `gethip_agen`: تدقيق `packages/approval-store` المستقل (Turso/JWT/17 اختبارًا) ثم قرار: دمج أم ريبو تجارب منفصل.

---

## 4. ما لا نفعله (خطوط حمراء)

- لا دمج `01a0e068` في أي خط (نصيًا نظيف، دلاليًا نظامان).
- لا استيراد `celia/` ولا مخزن SQLite ثانٍ (قرار مؤقفل).
- لا حذف لفرع نشط بلا تأكيد المالك.
- لا squash للـPR الكبير (التاريخ الدقيق هو ما جعل هذا الفرز ممكنًا).
- لا نقل بلا بوابات كاملة على الفرع المستقبِل.

---

## 5. أسئلة للمالك (تحسم قبل التنفيذ)

1. تأكيد تجميد `01a0e068` (وإيقاف/تحويل الجلسة العاملة عليه إن وُجدت)؟
2. دمج حقيقي أم squash لخط GEN إلى `main`؟ (التوصية: merge)
3. بدء خطوة 1 (PR إلى `main`) الآن؟
4. تدقيق `gethip_agen/approval-store` — هنا أم في جلسته؟

---

## 6. In English (short)

- **Single source:** the `lib/*` line on `arena/01a0e1ab-leader2027` (integrated, contracted, 346/346 + 58/58).
- **`celia/` on `01a0e068`: archive, don't merge** — contradicts the locked `persistence=repos` decision (separate SQLite), deliberately standalone, no manifest integration; textually zero-conflict but semantically a second system.
- **Salvage only:** security hardening from `01a0e01a` (secret-scan test + hint removal + drift/manifest unit), the 84-case policy-matrix test from `01a0e000` adapted 14→16 actions, and the AIsa external-evidence *pattern* as P4 reference (not code).
- **4 branches are content-fully-merged** (0 unique files; squash-counts lie) — delete after record. Sequence: freeze coordination → ours-to-main PR (real merge) → security → matrix → tag+delete → externals.
