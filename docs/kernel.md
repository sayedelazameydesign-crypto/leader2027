# النواة الحيّة والأنوية الذرية
**Live Kernel & Atomic Nuclei** — معمارية VS4

---

## 1. الفكرة في سطر واحد

النظام ليس بناءً واحدًا يُهدم ليُعدَّل، بل **نواة حيّة** تضمّ أركانًا (أنوية ذرية) مستقلة،
كل ركن يُعدَّل ويُستبدل **وهو يعمل**، دون أن يمسّ ذلك معمارية النظام ولا باقي الأركان.

> In one line: the system is not one monolith that must be torn down to change — it is a **living kernel** with independent corners (atomic nuclei), each tunable and swappable **while running**, without touching the architecture or the other corners.

---

## 2. الطبقات الثلاث

```
        ┌──────────────────────────────────────────────────────────┐
        │  HTTP / UI  —  app/api/kernel/**  ·  /kernel            │   ← السطح
        ├──────────────────────────────────────────────────────────┤
        │  KERNEL  —  lib/kernel/                                  │   ← النواة
        │  types · manifest · bus · approvals · kernel · registry  │
        │  bridge                                                  │
        ├──────────────────────────────────────────────────────────┤
        │  CELLS  —  lib/cells/*  (8 أركان)                         │   ← الأنوية الذرية
        │  audit auth people volunteers field reporting settings ai │
        └──────────────────────────────────────────────────────────┘
```

| الملف | الدور |
|---|---|
| `lib/kernel/types.ts` | العقود: `Cell`, `CellManifest`, `Capability`, `ToolDescriptor`, `ConfigSlot`, `LifecycleState`, `ApprovalRequest`, `ToolContext`, `defineCell()` |
| `lib/kernel/manifest.ts` | التحقق قبل التشغيل: `validateCell` (قدرة ↔ خدمة 1:1)، نمط أسماء القدرات، أدوات الكتابة تُلزم بالموافقة |
| `lib/kernel/bus.ts` | الناقل: حلقة أحداث (200)، عزل خطأ المستمعين → `kernel.subscriber.failed` |
| `lib/kernel/approvals.ts` | الموافقات: TTL 15 دقيقة، **استخدام واحد** (`consume`)، توقيع `ApprovalStamp` |
| `lib/kernel/kernel.ts` | النواة: التسجيل، الإقلاع، الفحص الصحي، الاستبدال الساخن، بوابة `execute`، `configure` |
| `lib/kernel/registry.ts` | **جذر التركيب الوحيد**: قائمة الأنوية الثمانية + `boot/get/reboot` |
| `lib/kernel/bridge.ts` | الجسر إلى العالم القديم: `toDomainActor`، `repos`، `stringSlot`، `numberSlot` |

---

## 3. خمسة قوانين لا تُخترق

### 1) انعكاس الاعتماد (IoC)
**النواة لا تعرف أي نواة ذرية.** لا يوجد `import` واحد من `lib/kernel/**` إلى `lib/cells/**`.
المعرفة كلها في `registry.ts` — نقطة تجميع واحدة تُبنى فيها القائمة وتُمرَّر.

```ts
// registry.ts — المكان الوحيد الذي تلتقي فيه الأنوية
export const CELLS: CellFactory[] = [auditCell, authCell, peopleCell, /* … */];
```

### 2) لا استيراد بين الأنوية
لا قيمةً ولا نوعًا. `volunteers` تحتاج شخصًا؟ تطلبه من **قدرة** `people.read`:

```ts
const people = ctx.require<PeopleRead>("people.read");
```

فحص آلي في `scripts/check-manifest-drift.mjs` يمنع أي استيراد بين نواة وأخرى من جديد.

### 3) القدرة واجهة، لا اسم
كل قدرة مُعلَنة **يجب** أن يكون لها خدمة فعلية (1:1 يتحقق منه `validateCell`)،
و`ctx.require(cap)` هي الطريقة الوحيدة للوصول. لا يوجد وصول مباشر إلى مخزن أو إلى النواة.

### 4) المَقابض مُعلَنة مسبقًا
`configure(cellId, patch)` يقبل فقط المفاتيح المُعلَنة في `CellManifest.config`.
أي مفتاح آخر → **رفض** (400). فيستحيل أن يغيّر إعدادُ ركنٍ سلوكَ ركنٍ آخر.

### 5) بوابة واحدة للكتابة (2027)
لا وكيل ذكاء اصطناعي يكتب بلا **موافقة بشرية** مُدقَّقة:

```
وكيل ──tool(write)──▶  pending_approval
                          │
              إنسان (users:manage) ──▶ grant ──▶ تصريح صالح لمرة واحدة
                          │
                  الوكيل يُعيد التنفيذ ──▶ يُنفَّذ بسلطة المُعتمِد
```

- الطلب: `kernel.approval.requested` مع `on_behalf_of: agent:<name>`.
- الاعتماد: `ai.approval.granted` — **يمرّ عبر أداة مُدقَّقة**، لا عبر البوابة مباشرة.
- إعادة الاستخدام → `denied` (استخدام واحد).
- **تفويض لا تصعيد**: العملية تُنفَّذ بسلطة المُعتمِد (`decidedByRole`)، ودور مجهول ⇒ رفض افتراضي.

---

## 4. النواة الحيّة: ماذا يعني «حيّة»؟

| السلوك | كيف يتحقق |
|---|---|
| **إقلاع مرتّب** | كل نواة تُعلن `dependencies` من القدرات، والفشل يعزل النواة وحدها |
| **فحص صحة** | لكل نواة `health()` — الفشل ⇒ `degraded` لا سقوط النظام |
| **عزل الفشل** | نواة معطوبة = `blocked`/`degraded`، والباقي يعمل بلا تأثّر |
| **استبدال ساخن** | نسخة جديدة تُفحص صحتها **قبل** إزالة القديمة، والإعدادات تُنقَل معها |
| **ذاكرة تُبطَل بالأحداث** | `reporting` تُبطل ذاكرتها عند الحدث وتُعيد الحساب — الرقم يتحدّث فورًا |
| **بلا إعادة تشغيل** | التعديل يقع والنظام يخدم الطلبات |

---

## 5. الأركان الثمانية

| النواة | الركن | تُشبع |
|---|---|---|
| `audit` | سجل التدقيق | `audit.trail`, `audit.read` |
| `auth` | الهوية والجلسات | `auth.session`, `auth.login` |
| `people` | سجل الأشخاص | `people.read`, `people.write` |
| `volunteers` | دورة حياة المتطوع | `volunteers.read`, `volunteers.write` |
| `field` | التقارير الميدانية | `field.reports.read`, `field.reports.write` |
| `reporting` | لوحة القيادة والمؤشرات | `reporting.kpis` |
| `settings` | إعدادات الحملة | `settings.campaign`, `settings.structure` |
| `ai` | الوكلاء والموافقات | `ai.catalogue`, `ai.approvals` |

المجموع: **8 أنوية · 17 قدرة · 27 أداة**.

---

## 6. السطح: كيف يُعدِّل المستخدم ركنًا؟

| الطريقة | المسار | الصلاحية |
|---|---|---|
| صورة حيّة | `GET /api/kernel` | جلسة + `dashboard:view` |
| تعديل مَقبض | `PATCH /api/kernel` | `settings:manage` |
| كتالوج للوكلاء | `GET /api/kernel/cells?cell=…` | جلسة / وكيل مفوَّض |
| تنفيذ أداة | `POST /api/kernel/actions` | حسب مخاطر الأداة |
| اعتماد/رفض | `POST /api/kernel/actions` (`grant`/`deny`) | `users:manage` |
| الشاشة | `/kernel` | `dashboard:view` |

**تعديل ركن واحد لا يمسّ غيره** — إثبات عملي من الفحص الحيّ:

```
PATCH /api/kernel  {cell:"people", config:{list_limit:42}}
→ 200 {changed:["list_limit","default_source"]}     ← ركن people تغيّر
   field ⇒ 500                                       ← ركن field لم يتغيّر
```

---

## 7. غير مُخِلٍّ بالتوافق (Non-breaking)

- الطبقة الجديدة **إضافة**: 98 اختبارًا قديمًا لم تُلمس وظلّت خضراء.
- مسارات HTTP الحالية تعمل كما هي — النواة سطحٌ إضافي لا بديل.
- الجسر `bridge.ts` يترجم بين لغة النواة ولغة المجال القائمة (`Result`, `repos`, الأدوار).
- المذهب: **العزل قبل الذكاء** — كل قدرة ذكاء اصطناعي تمرّ ببوابة بشرية مُدقَّقة.

---

## 8. البوابات

| البوابة | الأمر | النتيجة |
|---|---|---|
| الأنواع | `npm run typecheck` | ✅ نظيف |
| الاختبارات | `npm test` | ✅ **166/166** (98 قائمة + 68 للنواة) |
| البناء | `npm run build` | ✅ يشمل `/kernel` ومسارات النواة |
| Smoke حيّ | `npm run smoke` | ✅ **45/45** ضد خادم قائم |
| README | `npm run readme:check` | ✅ متزامن |
| الانحراف | `npm run readme:drift` | ✅ (يشمل فحص عزل الأنوية) |

---

## 9. In English (short)

- **Inversion of Control** — the kernel knows no nucleus; `registry.ts` is the only composition root; cells never import each other, only capabilities flow between them.
- **Atomic nuclei** — eight self-contained corners, each declaring capabilities, events, tools, and config slots; each reaches `active` on its own, and a failing corner degrades alone.
- **Hot swap** — a new cell version is health-checked before the old instance unmounts, with configuration carried across; no restart.
- **Declared knobs only** — undeclared config keys are rejected, so nothing can reach across corners.
- **Isolation before intelligence** — every agent write passes a single audited human-approval gate; approvals are single-use, and the action runs under the approver's authority, never above it.
- **Non-breaking** — the layer is additive; all 98 pre-existing tests remain green.
