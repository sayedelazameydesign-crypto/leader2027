# Celia — نظام تشغيل الوكلاء (Agent OS) · NEXA طبقة الحوكمة وثقة التنفيذ

> **الحالة الصادقة:** هذا المجلد = **GEN-0 Foundation + GEN-1 Real Execution Boundary** — نواة NEXA، بوابة تنفيذ قبلية،
> حارس موارد fail-closed، رسم دليل بسلسلة تجزئة، عقد نتيجة، وأول قدرة (AIsa) تمرّ **عبر البوابة** بدليل CI حقيقي.
> ليس «Celia 2027». ما لم يُذكر أدناه على أنه `EXISTS` فهو غير مبني. القاعدة §24 تنطبق على هذا الملف نفسه:
> **CAN ≠ AVAILABLE ≠ AUTHORIZED ≠ EXECUTABLE ≠ EXECUTED ≠ VERIFIED.**
>
> ```text
> Model ≠ Agent · Agent ≠ Authority · Adapter ≠ Permission · Execution ≠ Verification · Memory ≠ Evidence
> ```

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
├── nexa/                      # EXISTS (GEN-0 + GEN-1)
│   ├── protocol.ts            # Action Protocol (§23) + Capability Ladder (§24) + تجزئة الاقتراح
│   ├── capability.ts          # سجل القدرات — الحالة تُرفع بدليل، درجةً واحدة، لا تُعلَن
│   ├── policy.ts              # Policy decides: تصنيف البيانات (§18) · التكلفة (المدفوع ⇒ موافقة) · الخطورة · المحاكاة · الثقة
│   ├── authorization.ts       # Authorization permits: منح بشرية أحادية الاستعمال، مربوطة بتجزئة الاقتراح
│   ├── cost-guard.ts          # ميزانيات صلبة (مهمة/وكيل/مجموع) — حجز → تسوية/إفراج — دفتر
│   ├── resource-guard.ts      # GEN-1: حصص fail-closed — 80% WARN · 90% RESTRICT · 95% SAFE_MODE · 100% DENY
│   ├── execution.ts           # حدّ التنفيذ: DeniedExecutor افتراضيًا · SimulationExecutor (§16) · ProviderExecution · runAction
│   ├── gateway.ts             # GEN-1: ExecutionGateway — القرار قبل التنفيذ، إيصال دليل لكل طلب (مُنفَّذ أو مرفوض)
│   ├── evidence.ts            # Evidence Graph (§14) إلحاقي بسلسلة تجزئة + Replay (§15) + explain()
│   ├── verification.ts        # Outcome Contract (§6): COMPLETED/PARTIAL/BLOCKED/NOT_VERIFIED/FAILED
│   └── index.ts
├── adapters/
│   └── aisa/                  # EXISTS — أول قدرة تمرّ عبر البوابة
│       ├── adapter.ts         # النقل الخام (بعدّاد نداءات) + السياسة + المستخرجات + الدليل المنقّح
│       ├── provider.ts        # GEN-1: المزوّد داخل الحدّ — 4 عمليات مجانية قرائية؛ paid use معطّل بنيويًا
│       ├── pipeline.ts        # GEN-1: خط الأنابيب المحكوم — كل نداء = اقتراح إلى البوابة
│       ├── bridge.ts          # حكم NEXA offline: سلسلة الدليل + الإيصالات + العقد + GEN1_GATE
│       └── contract.readonly.json · README.md
├── apps/ core/ runtime/ mesh/ evolution/ observability/     # PLANNED — غير موجودة
├── nexa/{identity,acl,approvals}                            # PLANNED — غير موجودة (approvals جزئيًا داخل authorization.ts)
└── adapters/{github,vercel,cloudflare,mcp}                  # PLANNED — غير موجودة
```

## بروتوكول الفعل (§23) — كما هو مُنفَّذ

`INTENT → PROPOSAL → CAPABILITY → POLICY → AUTHORIZATION → APPROVAL → EXECUTION → OBSERVATION → VERIFICATION → EVIDENCE → MEMORY`

- `advance()` يقبل المرحلة التالية مباشرةً فقط — لا قفز فوق POLICY/AUTHORIZATION/APPROVAL.
- `raiseLadder()`/`CapabilityRegistry.raise()` يرفعان السلّم درجةً واحدة **بمرجع دليل إلزامي**؛ `assertLadderConsistent()` يمنع «EXECUTED» قبل OBSERVATION.
- `proposalHash` = تجزئة (القدرة، العملية، المعاملات، السقف) — ما تُربط به المنح؛ الطوابع الزمنية والمعرّفات خارجها.

## بوابة التنفيذ (GEN-1) — `nexa/gateway.ts`

```text
Proposal → CAPABILITY (resolver: قدرة معروفة؟ مزوّد معروف؟ حدّ مربوط؟)
        → POLICY (+ resource guard) → AUTHORIZATION → APPROVAL (grants)
        → COST (reservation) → EXECUTION (boundary) → OBSERVATION → VERIFICATION → EVIDENCE (receipt) → MEMORY
```

| قاعدة | أين تُنفَّذ |
|---|---|
| no authorization → no execution | `authorize()` ثم `assertExecutable()` داخل `runAction` (دفاع مزدوج) |
| no approval → no risky execution | write/admin/destructive **والمدفوع** ⇒ REQUIRE_APPROVAL؛ بلا منح ⇒ `DENIED@APPROVAL` |
| unknown cost → deny | `costRule`: dynamic/unknown ⇒ DENY |
| unknown capability / provider → deny | `DENIED@CAPABILITY` قبل السياسة |
| quota exhausted → deny · SAFE_MODE → قراءة مجانية فقط | `ResourceGuard.admit()` كقاعدة سياسة |
| كل طلب يترك إيصالًا | `EvidenceReceipt` + عقد action/policy/authorization/observation/verification في الرسم |

إثبات «البوابة قبلية» في الدليل: `transport_calls == boundary_calls == executed` و`ungated_calls = 0`،
وكل إيصال مُنفَّذ يحمل تاريخ مراحله (POLICY وAUTHORIZATION وAPPROVAL قبل EXECUTION). المنح أحادي الاستعمال يُحرق عند عبور EXECUTION.

## سلّم القدرة (§24) — من يرفع ماذا

سلّمان مستقلان: سلّم **الفعل** (في الإيصال) وسلّم **القدرة** (في السجل، `registryState`).

| الدرجة | سلّم الفعل — من يثبتها | سلّم القدرة — الحالة في AIsa |
|---|---|---|
| CAN | اقتراح لقدرة مسجّلة | كل `aisa:*` عند التسجيل |
| AVAILABLE | القدرة مُحلّلة إلى مزوّد معروف وحدّ مربوط | العمليات الأربع بعد إيصال `list_categories` 200 (لا بادّعاء) |
| AUTHORIZED | سياسة ≠ DENY + (قراءة مجانية مقبولة أو منح بشري) | — |
| EXECUTABLE | حجز التكلفة (إن وُجدت) قبل EXECUTION | — |
| EXECUTED | ملاحظة من الحدّ | — |
| VERIFIED | الملاحظة متسقة مع الاقتراح (ok، لا آثار جانبية للقراءة، التكلفة ≤ السقف) | — |

في CI الحقيقي: 6 أفعال قرائية مجانية بلغت VERIFIED/EXECUTED؛ المرشحون المدفوعون `use:<id>` رُفضوا عند POLICY/APPROVAL قبل المزوّد —
والمزوّد نفسه لا يملك طريقًا مدفوعًا (`PAID_USE_DISABLED`).

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
| `cost` | `dynamic`/`unknown` ⇒ DENY (لا حدّ أعلى موثّق) · `fixed` > سقف الاقتراح أو > الميزانية المتبقية ⇒ DENY · **أي فعل مدفوع ⇒ REQUIRE_APPROVAL** (paid execution = OFF BY DEFAULT) |
| `resources` (البوابة) | حارس الموارد: DENY عند 100%، SAFE_MODE (95%) قراءة مجانية فقط، RESTRICT (90%) لا مدفوع/admin/destructive |
| `risk` | خطورة مُقلَّلة ⇒ DENY · `read` على قدرة غير قرائية ⇒ DENY · تدميري بلا محاكاة ⇒ DENY · write/admin/destructive ⇒ REQUIRE_APPROVAL |
| `trust` | ثقة مجهولة ⇒ REQUIRE_APPROVAL حتى للقراءة |

`ADMIT` ليس تصريح تنفيذ؛ `authorize()` يرفض حتى الـADMIT إن كان الفعل غير قرائي بلا منح (دفاع في العمق).

## الدليل الحقيقي (AIsa عبر البوابة)

سير العمل `.github/workflows/aisa-adapter-evidence.yml` يشغّل `pipeline.ts` بمفتاح CI (كل نداء عبر البوابة) ثم يمرّر مخرجاته —
بما فيها رسم الدليل الذي أنتجته البوابة أثناء التشغيل — إلى `bridge.ts` الذي يتحقق من السلسلة والإيصالات ويحكم بالعقد.
التعليقات (ASCII): `NEXA_OUTCOME=…`, `NEXA_GEN1_GATE runtime=…`, `NEXA_GATEWAY …`, `NEXA_CAPABILITY aisa=…`, `NEXA_PROPOSALS …`, `NEXA_EVIDENCE runtime_chain=…`, `NEXA_FACTS …`, `NEXA_MODE …`.

```text
GEN1_GATE = real_execution_pre_gate_verified AND paid_use_calls = 0 AND secret_exposure = 0 AND tests_pass
            (الثلاثة الأولى يحسبها الجسر من دليل runtime؛ tests_pass = سير عمل ci.yml)
```

راجع [`adapters/aisa/README.md`](./adapters/aisa/README.md).

## خارطة الطريق (§25) — مصفوفة الحالة

| جيل | المحتوى | الحالة |
|---|---|---|
| v0.1 GEN-0 Foundation | NEXA (protocol · capability · policy · authorization · cost · execution boundary · evidence · verification) | **EXISTS · TESTED · RUNTIME VERIFIED** |
| v0.2 GEN-1 Execution Gate | ExecutionGateway · CapabilityResolver · AuthorizationGate · ApprovalGate · CostReservation · ProviderExecution · EvidenceReceipt · ResourceGuard | **EXISTS · TESTED · RUNTIME VERIFIED** (AIsa عبر البوابة في CI؛ `GEN1_GATE runtime=PASS`) |
| v0.3 GEN-2 Agent Core | planner · context · decision loop · recovery | PLANNED — لا وكيل |
| v0.4 GEN-3 Task Engine | مهام دائمة بحالات PLANNED…COMPLETED | PLANNED |
| v0.5 GEN-4 Tool Runtime | FILES/TERMINAL/GIT/GITHUB/WEB/… كمزوّدين خلف البوابة | PLANNED — لا منفّذ حقيقي غير AIsa القرائي |
| v0.6–v0.9 | Skills · Subagents · Workspace · Project Brain | PLANNED |
| v1.0–v1.2 | Browser/Computer runtime (device bridge) · Model Mesh | PLANNED |
| v1.3–v2.0 | Memory · Evidence platform · Cloud control plane (Cloudflare free-first) · Beta · Agent OS | PLANNED — لا نشر سحابي بعد |

## مصفوفة الحالة لكل مكوّن (Definition of Done §21)

`NOT_PRESENT → PLANNED → IMPLEMENTED → TESTED → CONNECTED → EXECUTED → VERIFIED → PRODUCTION_VERIFIED`

| مكوّن | الحالة | الدليل |
|---|---|---|
| NEXA core (GEN-0) | VERIFIED | اختبارات + دليل CI |
| ExecutionGateway + ProviderExecution (GEN-1) | VERIFIED | `tests/unit/celia-gateway.test.ts` + تشغيل CI حقيقي عبر البوابة |
| ResourceGuard | EXECUTED | يعمل في CI بحصص ذاتية (`aisa.requests`, `aisa.spend_usd`)؛ حصص Cloudflare/GitHub الحقيقية = PLANNED |
| AIsa provider (4 عمليات مجانية) | VERIFIED | `GEN1_GATE runtime=PASS` |
| AIsa paid `use` | NOT_PRESENT (عمدًا) | `PAID_USE_DISABLED` بنيويًا |
| Human approval (grants) في CI | TESTED فقط | لا منح في CI؛ المسار مُختبَر بمنفّذ وهمي |
| Agent Core · Task Engine · Skills · Subagents · Workspace · Project Brain · Browser/Computer · Model Mesh · UI · Cloud deploy | NOT_PRESENT / PLANNED | — |

## ما لا يدّعيه هذا المجلد

- لا منفّذ حقيقي غير مزوّد AIsa القرائي المجاني؛ ملفات/طرفية/متصفح/GitHub/`use` مدفوع = غير موجودة، و`DeniedExecutor` هو الافتراضي.
- لا ذاكرة/Project Brain، لا Model Mesh، لا Skill Mesh، لا وكلاء متعددون، لا واجهة، لا نشر سحابي.
- «zero charge delta» من مصدر المزوّد نفسه = عدم‑تناقض، لا إثبات محاسبي مستقل.
- «pre_execution_gate_verified» إثبات **داخل العملية** (عدّاد النقل الخام مقابل تنفيذات البوابة + ترتيب المراحل في الإيصالات)؛
  ليس عزلًا على مستوى الشبكة/نظام التشغيل — ذلك يأتي مع Workspace/Device runtime.
- لا يعدّل هذا الكود نفسه ولا الحوكمة (§13): أي تغيير في `celia/nexa/` يمرّ بمراجعة بشرية كأي كود.
