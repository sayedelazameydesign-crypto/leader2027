# توليد الوثائق من مصدر الحقيقة الواحد (README Generation)

## القاعدة

`README.md` و `README.en.md` **ناتجان مشتقّان (Derived Artifacts)** —
لا يُعدَّلان يدويًا، ولا يدخلان في مسار الـbuild، ولا يمكن أن يُسقط تحديثُهما بناءَ النظام.

مصدر الحقيقة الوحيد هو **`project.manifest.json`** في جذر المستودع.

```text
project.manifest.json
        │
        ├── README.md          (عربي)      ← مُولَّد
        ├── README.en.md       (إنجليزي)   ← مُولَّد
        ├── metadata (نسخة/ترخيص/Node/سكربتات) ← يُقرأ من package.json
        └── drift check (استشاري مقابل الكود)
```

## لماذا لا يُولَّد الـREADME من ملفات الكود مباشرة

لأن استنتاج حالة النظام من البحث في مئات الملفات هشّ: أي إعادة تسمية أو تحريك ملف
تُنتج وثيقة خاطئة بصمت. لذلك:

- **المولّد لا يقرأ الكود إطلاقًا** — يقرأ `project.manifest.json` و `package.json` فقط.
- الحقائق المُعلَنة (الأدوار، الإجراءات، مصفوفة الصلاحيات، مسارات API، الحسابات) **تُكتب صراحةً في الـmanifest**.
- التحقق من مطابقة الـmanifest للكود **منفصل تمامًا** في سكربت استشاري (`readme:drift`) **لا يُفشل شيئًا**.

## التدفق (فشل التوليد لا يُفشل البناء)

```text
              ┌──────────────────┐
              │   Source Code    │
              └────────┬─────────┘
                       ↓
             ┌──────────────────┐
             │  Build + Tests   │
             └────────┬─────────┘
                      ↓
                   PASS?
                  /     \
                NO       YES
                ↓         ↓
              STOP   Generate README
                          ↓
                  README generation
                     /        \
                   OK         FAIL
                   ↓            ↓
             تحديث README   Warning only
                   ↓            ↓
                   └───── DONE ─┘
```

يُترجم ذلك في CI إلى خطوة **`continue-on-error: true`** بعد بوابات البناء والاختبار:

```yaml
- name: README generation (advisory — لا يُفشل البناء)
  continue-on-error: true
  run: npm run readme:warn
```

## الأوامر

| الأمر | السلوك |
| --- | --- |
| `npm run readme:generate` | يكتب `README.md` + `README.en.md` من الـmanifest. فشل ⇒ خروج 1 |
| `npm run readme:generate -- --warn-only` | نفسه، لكن الفشل **تحذير فقط** ⇒ خروج 0 (المستخدم في CI) |
| `npm run readme:check` | يقارن الملفات على القرص بالمخرجات المُولَّدة. انحراف ⇒ خروج 1 |
| `npm run readme:check -- --warn-only` | كشف الانحراف بلا إفشال |
| `npm run readme:drift` | **استشاري**: الـmanifest مقابل الكود (نسخة/أدوار/إجراءات/مصفوفة/حسابات/مسارات API/متغيرات/وثائق) — تحذيرات فقط |
| `npm run readme:drift -- --strict` | نفسه بخروج 1 عند الانحراف (للاستخدام اليدوي/بوابة اختيارية) |
| `npm run readme` | `readme:generate` ثم `readme:check` (الاستخدام اليدوي اليومي) |

## المخرجات حتمية

لا يحتوي المولّد على طابع زمني ولا أي مدخل غير حتمي — لذلك `readme:check`
كاشف انحراف موثوق: فرقٌ في المخزون يعني اختلافًا حقيقيًا عن الـmanifest.

## دورة العمل المعتادة

```bash
# 1) عدّل مصدر الحقيقة
$EDITOR project.manifest.json

# 2) ولّد الوثائق
npm run readme:generate

# 3) تأكد أن الكود ما زال مطابقًا للـmanifest (اختياري، تحذيرات فقط)
npm run readme:drift

# 4) اcommit الملفات الثلاثة معًا
git add project.manifest.json README.md README.en.md && git commit
```

## ما الذي يأتي من package.json

النسخة، الترخيص في الـbadge، وعدد Node من الـmanifest — والنسخة و**قائمة الأوامر** من
`package.json` (مع شرح كل أمر من `scriptNotes` في الـmanifest). بهذا تظهر أي أوامر
جديدة تلقائيًا في الـREADME، وتُعلَن حقائقها في مكان واحد.

## ما الذي يتحقق منه `readme:drift`

| الفحص | المصدر |
| --- | --- |
| النسخة | `package.json` |
| الأدوار | `lib/authorization/roles.ts` |
| الإجراءات + صفوف المصفوفة (إجراءً بإجراء) | `lib/authorization/policy.ts` |
| بريد الحسابات المزروعة | `lib/persistence/seed.ts` |
| المتغيرات البيئية المستخدمة | `container.ts` / `session.ts` / smoke |
| مسارات API | شجرة `app/api/**/route.ts` |
| ملفات الوثائق ومخرجات README | نظام الملفات |

كلها **تحذيرات** لا تُفشل الـbuild. راجع النتائج وحدّث الـmanifest عند الانحراف المشروع.
