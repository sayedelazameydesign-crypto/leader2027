# Celia — نظام تشغيل الوكلاء (Agent OS) · NEXA طبقة الحوكمة وثقة التنفيذ

> **الحالة الصادقة:** هذا المجلد هو **GEN-0 Foundation** فقط — نواة NEXA + رسم الدليل + عقد النتيجة + أول قدرة (AIsa) بدليل CI حقيقي.
> ليس «Celia 2027». ما لم يُذكر أدناه على أنه `EXISTS` فهو غير مبني. القاعدة §24 تنطبق على هذا الملف نفسه:
> **CAN ≠ AVAILABLE ≠ AUTHORIZED ≠ EXECUTABLE ≠ EXECUTED ≠ VERIFIED.**

```text
AI → proposes · Policy → decides · Authorization → permits · Execution Authority → executes · Evidence → verifies
```

## لماذا هنا؟ وكيف يُستخرج؟

`celia/` يعكس جذر مستودع Celia المستقبلي (§22) ولا يستورد شيئًا من Leader 2027، ولا يستورده `app/` أو `lib/` أو `components/`.
الوحدات TypeScript نقية بلا تبعيات، تعمل مباشرةً بـNode ≥ 22.18 (type stripping) عبر استيرادات `./x.ts` النسبية.
الاستخراج إلى مستودع مستقل بتاريخه:

```bash
git subtree split --prefix=celia -b celia-export
```

## التخطيط (الموجود مقابل الهدف §22)

```text
celia/
├── nexa/                      # EXISTS (GEN-0)
│   ├── protocol.ts            # Action Protocol (§23) + Capability Ladder (§24) + تجزئة الاقتراح
│   ├── capability.ts          # سجل القدرات — الحالة تُرفع بدليل، درجةً واحدة، لا تُعلَن
│   ├── policy.ts              # Policy decides: تصنيف البيانات (§18) · التكلفة · الخطورة · المحاكاة · الثقة
│   ├── authorization.ts       # Authorization permits: منح بشرية أحادية الاستعمال، مربوطة بتجزئة الاقتراح
│   ├── cost-guard.ts          # ميزانيات صلبة (مهمة/وكيل/مجموع) — حجز → تسوية/إفراج — دفتر
│   ├── execution.ts           # حدّ التنفيذ: DeniedExecutor افتراضيًا · SimulationExecutor (§16) · runAction
│   ├── evidence.ts            # Evidence Graph (§14) إلحاقي بسلسلة تجزئة + Replay (§15) + explain()
│   ├── verification.ts        # Outcome Contract (§6): COMPLETED/PARTIAL/BLOCKED/NOT_VERIFIED/FAILED
│   └── index.ts
├── adapters/
│   └── aisa/                  # EXISTS — أول قدرة: محوّل قراءة‑فقط + جسر دليل NEXA + عقد نتيجة
│       ├── adapter.ts · bridge.ts · contract.readonly.json · README.md
├── apps/ core/ runtime/ mesh/ evolution/ observability/     # PLANNED — غير موجودة
├── nexa/{identity,acl,approvals}                            # PLANNED — غير موجودة (approvals جزئيًا داخل authorization.ts)
└── adapters/{github,vercel,cloudflare,mcp}                  # PLANNED — غير موجودة
```

## بروتوكول الفعل (§23) — كما هو مُنفَّذ

`INTENT → PROPOSAL → CAPABILITY → POLICY → AUTHORIZATION → APPROVAL → EXECUTION → OBSERVATION → VERIFICATION → EVIDENCE → MEMORY`

- `advance()` يقبل المرحلة التالية مباشرةً فقط — لا قفز فوق POLICY/AUTHORIZATION/APPROVAL.
- `raiseLadder()`/`CapabilityRegistry.raise()` يرفعان السلّم درجةً واحدة **بمرجع دليل إلزامي**؛ `assertLadderConsistent()` يمنع «EXECUTED» قبل OBSERVATION.
- `proposalHash` = تجزئة (القدرة، العملية، المعاملات، السقف) — ما تُربط به المنح؛ الطوابع الزمنية والمعرّفات خارجها.

## سلّم القدرة (§24) — من يرفع ماذا

| الدرجة | من يثبتها | في GEN-0 |
|---|---|---|
| CAN | التسجيل في `CapabilityRegistry` | `aisa`, `aisa:<operation>` |
| AVAILABLE | دليل اتصال/مصادقة | `aisa` بعد `AISA_MCP_AUTH=VERIFIED` (دليل CI حقيقي) |
| AUTHORIZED | سياسة ≠ DENY + منح بشري مطابق (`authorize`) | لم يحدث لأي قدرة مدفوعة/كتابية — لا منح |
| EXECUTABLE | حجز تكلفة + منفّذ مربوط (`assertExecutable`) | لا منفّذ حقيقي مربوط (`DeniedExecutor`) |
| EXECUTED | ملاحظة من المنفّذ | — |
| VERIFIED | عقد النتيجة `COMPLETED` | مهمة الاكتشاف القرائي فقط (post-hoc) |

## عقد النتيجة (§6)

```json
{ "goal": "…", "required": ["fact_a"], "forbidden": ["fact_x"], "blockers": ["fact_b"] }
```

الحقائق `true | false | "unknown"`. الحقيقة المفقودة = `"unknown"`. الحكم: ممنوع صحيح ⇒ **FAILED** · عائق ⇒ **BLOCKED** ·
مطلوب خاطئ ⇒ **PARTIAL** (إن تحقق غيره) وإلا **FAILED** · أي مجهول ⇒ **NOT_VERIFIED** · وإلا **COMPLETED**.

## السياسة الافتراضية (`DEFAULT_RULES`)

| قاعدة | الأثر |
|---|---|
| `data-class` | تصنيف الاقتراح > تصريح القدرة ⇒ DENY · وضع LOCAL: غير المحلي لا يستقبل إلا PUBLIC · HYBRID: PRIVATE فما فوق يبقى محليًا |
| `cost` | `dynamic`/`unknown` ⇒ DENY (لا حدّ أعلى موثّق) · `fixed` > سقف الاقتراح أو > الميزانية المتبقية ⇒ DENY |
| `risk` | خطورة مُقلَّلة ⇒ DENY · `read` على قدرة غير قرائية ⇒ DENY · تدميري بلا محاكاة ⇒ DENY · write/admin/destructive ⇒ REQUIRE_APPROVAL |
| `trust` | ثقة مجهولة ⇒ REQUIRE_APPROVAL حتى للقراءة |

`ADMIT` ليس تصريح تنفيذ؛ `authorize()` يرفض حتى الـADMIT إن كان الفعل غير قرائي بلا منح (دفاع في العمق).

## الدليل الحقيقي الأول (AIsa)

سير العمل `.github/workflows/aisa-adapter-evidence.yml` يشغّل المحوّل بمفتاح CI ثم يمرّر مخرجاته إلى `bridge.ts`.
التعليقات المتوقعة (ASCII): `NEXA_OUTCOME=…`, `NEXA_CAPABILITY aisa=…`, `NEXA_POLICY …`, `NEXA_EVIDENCE … chain=ok`, `NEXA_FACTS …`, `NEXA_MODE …`.
راجع [`adapters/aisa/README.md`](./adapters/aisa/README.md).

## خارطة الطريق (§25) — مصفوفة الحالة

| جيل | المحتوى | الحالة |
|---|---|---|
| GEN-0 Foundation | NEXA (protocol · capability · policy · authorization · cost · execution boundary · evidence · verification) | **EXISTS** — مُختبَر (`tests/unit/celia-*.test.ts`) |
| GEN-0 Foundation | Agent Core · Task Engine · Tool Runtime (منفّذات حقيقية) | **PLANNED** — لا وكيل، لا محرّك مهام، لا منفّذ حقيقي |
| GEN-1 Power Core | المحوّل يمرّ عبر حدّ التنفيذ قبل النداء · Computer runtime · Project Brain · Model Mesh | PLANNED |
| GEN-2…GEN-7 | Evolution · Multi-agent · Marketplace · Sovereign · Enterprise · Autonomous | PLANNED |

## ما لا يدّعيه هذا المجلد

- لا منفّذ حقيقي (ملفات/طرفية/متصفح/`use` مدفوع في AIsa) — `DeniedExecutor` هو الافتراضي عمدًا.
- لا ذاكرة/Project Brain، لا Model Mesh، لا Skill Mesh، لا وكلاء متعددون، لا واجهة.
- تحقق AIsa في GEN-0 **بعد** التنفيذ (post-hoc)؛ البوابة قبل التنفيذ = GEN-1.
- «zero charge delta» من مصدر المزوّد نفسه = عدم‑تناقض، لا إثبات محاسبي مستقل.
- لا يعدّل هذا الكود نفسه ولا الحوكمة (§13): أي تغيير في `celia/nexa/` يمرّ بمراجعة بشرية كأي كود.
