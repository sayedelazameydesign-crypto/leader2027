# Celia — نظام تشغيل الوكلاء (Agent OS) · NEXA طبقة الحوكمة وثقة التنفيذ

> **الحالة الصادقة:** هذا المجلد = **GEN-0 Foundation + GEN-1 Real Execution Boundary + GEN-2 Agent Core + GEN-3 Task Engine** — نواة NEXA، بوابة تنفيذ قبلية،
> حارس موارد fail-closed، رسم دليل بسلسلة تجزئة، عقد نتيجة، وكيل حتمي بآلة حالة مقيّدة (هدف → عقد → خطة → أفعال عبر البوابة → ملاحظة → تحقق → إعادة تخطيط)،
> مهمة دائمة على SQLite تستأنف من آخر نقطة تفتيش وتقف في WAITING_APPROVAL بانتظار منح بشري، وأول قدرة (AIsa) تمرّ **عبر البوابة** بدليل CI حقيقي (بما فيه قتل حقيقي للعملية واستئنافها).
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
├── core/                      # EXISTS (GEN-2 + GEN-3)
│   ├── task/                  # نموذج المهمة: آلة الحالة (+WAITING_APPROVAL/PARTIAL) · الخطوة · نقاط التفتيش المسلسلة · النتيجة · المهمة
│   │                          # GEN-3: store (واجهة + ذاكرة) · sqlite-store (node:sqlite) · approval (منح بشرية معلّقة) · artifact (مخرجات مجزّأة)
│   └── agent/                 # الوكيل: السياق · الفهم (قوالب) · الخطة (ربط/توقعات) · المخطِّط · الملاحظة · التحقق · التعافي · إعادة التخطيط · حلقة القرار القابلة للاستئناف · الإعادة (GEN2_GATE + GEN3_GATE)
├── adapters/
│   └── aisa/                  # EXISTS — أول قدرة تمرّ عبر البوابة (+ قوالب أهداف ووكيل GEN-2 فوقها)
│       ├── adapter.ts         # النقل الخام (بعدّاد نداءات) + السياسة + المستخرجات + الدليل المنقّح
│       ├── provider.ts        # GEN-1: المزوّد داخل الحدّ — 4 عمليات مجانية قرائية؛ paid use معطّل بنيويًا
│       ├── pipeline.ts        # GEN-1: خط الأنابيب المحكوم — كل نداء = اقتراح إلى البوابة
│       ├── bridge.ts          # حكم NEXA offline: سلسلة الدليل + الإيصالات + العقد + GEN1_GATE
│       ├── goals.ts · agent.ts # GEN-2/3: قالب هدف «اكتشاف AIsa» (+مخرجات) + CLI الوكيل: run / resume / approvals / approve / reject (+حقن عطل)
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

## محرّك المهام (GEN-3) — `core/task` + استئناف في `core/agent`

```text
CREATED > UNDERSTANDING > PLANNING > READY > EXECUTING > OBSERVING > VERIFYING
  VERIFYING        ⇒ COMPLETED | PARTIAL | READY | RECOVERING > REPLANNING > READY … | BLOCKED | FAILED
  PLANNING | READY ⇒ WAITING_APPROVAL ⇒ READY | REPLANNING | BLOCKED        (قبل EXECUTING فقط — أبدًا بعد VERIFYING)
```

| قاعدة بنائية | التطبيق |
|---|---|
| `WAITING_APPROVAL` من PLANNING/READY فقط | جدول `TASK_TRANSITIONS`؛ الوكيل يفحص قبليًا (`gateway.precheck`) فيقف **قبل** EXECUTING عندما تتطلب السياسة منحًا بشريًا |
| استئناف `WAITING_APPROVAL` يعيد التحقق من `proposalHash + operation + costCap` | عدم تطابق ⇒ DENY فوري (`approval.mismatch` في سجل التدقيق) ⇒ REPLANNING |
| `PARTIAL` من VERIFYING فقط — سلطة العقد لا الوكيل | خطوة بلا بديل تُحجب (ومن يعتمد عليها) وتُكمل الحلقة ما تبقّى، ثم يحكم العقد: PARTIAL / BLOCKED / FAILED |
| `BLOCKED` نهائي بلا إعادة تلقائية | ما رفضته NEXA لا يُعاد كما هو؛ الحالات النهائية بلا مخارج |

- **الاستمرارية:** كل انتقال = معاملة SQLite واحدة (`node:sqlite`، بلا تبعيات؛ D1 لاحقًا يطبّق `TaskStore` نفسها): نقطة تفتيش مسلسلة بالتجزئة + مدخلات الدليل الجديدة + لقطة المهمة.
- **الاستئناف:** `loadTaskForResume` يعيد سلسلة النقاط وسلسلة الدليل ويربطهما بلقطة المهمة **قبل** أي خطوة (تلاعب ⇒ `RESUME_INTEGRITY`)، ثم تُبنى البوابة فوق الرسم المحفوظ وتكمل الحلقة من الحالة المسجَّلة.
  انقطاع بعد EXECUTING = محاولة `INTERRUPTED` مسجَّلة: القراءة تُعاد مرة، وغير القراءة يُغلق fail-closed (تسوية يدوية).
- **الموافقات = منح بشرية معلّقة:** `ApprovalRequest` (pending/approved/rejected/expired + TTL + سجل تدقيق)؛ الموافقة (إنسان فقط، §3) تولّد Grant أحادي الاستعمال مربوطًا بالكامل؛ الرفض/الانتهاء ⇒ REPLANNING إن وُجد بديل وإلا PARTIAL/BLOCKED — لا استمرار صامت أبدًا.
- **المخرجات:** من خطوات VERIFIED فقط، مربوطة بـ stepId + actionId + رأس الدليل، بتجزئة تُعاد حسابيًا؛ تبقى متاحة في PARTIAL/BLOCKED.

```text
GEN3_GATE = persistence_verified ∧ resume_verified ∧ approval_flow_verified ∧ partial_verified ∧ artifacts_verified ∧ tests_pass
            (تُحسب من المخزن نفسه: core/agent/replay.ts --db … --task …؛ approval_flow_verified=tests عندما لا يُمارَس في التشغيل — لا موافقة بشرية مزيّفة في CI)
```

الاختبارات الحاسمة (`tests/unit/celia-task-engine.test.ts`): قتل العملية أثناء EXECUTING → إعادة تشغيل → استئناف من نقطة التفتيش → نفس نتيجة التشغيل المتواصل (ملف SQLite حقيقي)؛
خطوة تحتاج `NEXA_A_PAID` بلا منح → WAITING_APPROVAL → موافقة بشرية → استئناف → COMPLETED بأساس grant ومنح مستهلك؛ رفض/انتهاء/تلاعب → REPLANNING أو PARTIAL، والمرشح المدفوع لا يُنادى؛
عقد متحقق جزئيًا بلا بدائل ⇒ PARTIAL لا COMPLETED والمخرجات باقية. وفي CI الحقيقي: العملية تُقتل فعلًا (SIGKILL) بعد الالتزام الثالث بـEXECUTING ثم تُستأنف من الملف وتُعاد من المخزن.

## قرارات GEN-1 المحسومة (مثبتة في الكود والاختبارات)

| القرار | التطبيق |
|---|---|
| §1 `availability=unknown` ⇒ **DENY** لا موافقة | `Capability.availability: "known" \| "unknown"` + قاعدة `availability` ⇒ `NEXA_E_AVAILABILITY_UNKNOWN`؛ محور مستقل عن `trust` |
| §2 `DEFAULT_SPEND_CAP_USD = 0` | غير محدد ⇒ 0؛ غير صالح/سالب ⇒ `NEXA_E_COST_CAP_INVALID`؛ ديناميكي/مجهول ⇒ `NEXA_E_COST_UNKNOWN`؛ > السقف ⇒ `NEXA_E_COST_EXCEEDS_CAP`؛ أي مدفوع ⇒ `NEXA_A_PAID` (موافقة) |
| §3 سلطة أول تنفيذ مدفوع = إنسان | `Grant.principal: "human"` فقط (agent/system مرفوضان)؛ للمدفوع: منح أحادي الاستعمال مربوط بـ proposalHash **و**operation **و**سقف تكلفة؛ حدّ التنفيذ يعيد فحص `stamp.principal` |

الأثر على دليل AIsa: المرشحون المدفوعون الثلاثة كلهم `DENIED@POLICY` الآن (تكلفة > 0 + توفّر مجهول) — لا مسار موافقة لهم أصلًا.

## الوكيل (GEN-2) — `core/agent` فوق `core/task`

```text
USER → UNDERSTAND (قالب استراتيجية) → OUTCOME CONTRACT → PLAN (تحليل القدرات من السجل، ترتيب، رفض)
     → لكل خطوة: اقتراح ⇒ gateway.submit (= NEXA precheck + execution gate) → OBSERVE (إيصال) → VERIFY (توقّع تصريحي)
     → VERIFIED ⇒ الخطوة التالية · FAILED ⇒ RECOVERING (إعادة عابرة أو إعادة تخطيط) · NOT_VERIFIED ⇒ REPLANNING
     → بعد آخر خطوة: VERIFYING (عقد النتيجة يحكم) ⇒ COMPLETED | FAILED | BLOCKED
```

```text
CREATED → UNDERSTANDING → PLANNING → READY → EXECUTING → OBSERVING → VERIFYING ─┬─ READY | COMPLETED
                                                                                ├─ RECOVERING → EXECUTING | REPLANNING | FAILED
                                                                                └─ REPLANNING → READY | BLOCKED | FAILED
```

- الجدول `TASK_TRANSITIONS` هو القانون: `COMPLETED` لا يُبلَغ إلا من `VERIFYING`؛ `PLANNING → COMPLETED` مستحيل بنيويًا.
- كل انتقال = نقطة تفتيش مسلسلة بتجزئة (`prevHash/hash`) تحمل رأس رسم الدليل لحظتها؛ الإعادة offline تتحقق من الاثنين معًا.
- الوكيل **≠ نموذج لغوي**: الفهم في GEN-2 = قوالب استراتيجية حتمية (`TemplateUnderstanding`) — هدف غير معروف ⇒ BLOCKED لا تخمين. Model Mesh لاحقًا يطبّق `Understanding`/`Planner` نفسيهما.
- الوكيل لا يملك سلطة: لا مسار شبكي مباشر (`transport_calls == executed` يُقاس)، سقف الإنفاق 0، هدف يطلب أكثر ⇒ `GOAL_CONSTRAINT` ⇒ BLOCKED.
- ما رفضته NEXA لا يُعاد كما هو؛ التغيير يأتي من إعادة التخطيط (مرشح آخر)، وكل مرشح جديد يمرّ بالبوابة من جديد.
- الإنهاء مضمون: `maxAttempts` (20) · `maxReplans` (3) · `maxRetriesPerStep` (1).

```text
GEN2_GATE = agent_goal_verified ∧ outcome_contract_verified ∧ all_actions_gated ∧ replan_verified ∧ evidence_chain_valid ∧ no_paid_operation ∧ tests_pass
            (يحسبها core/agent/replay.ts من التقرير المسلسل وحده — بلا ثقة بالوكيل؛ tests_pass = ci.yml)
```

الاختبارات الحاسمة (`tests/unit/celia-agent.test.ts`): خطوة 1 PASS → خطوة 2 FAIL → ملاحظة → إعادة تخطيط → بديل PASS → خطوة 3 PASS → COMPLETED؛
أداة غير متاحة → إعادة تخطيط → البديل غير متاح → BLOCKED؛ تكلفة مجهولة → NEXA DENY → المزوّد لم يُنادَ قط؛ إضافة إلى الفهم/التعافي/الإنهاء/آلة الحالة/التلاعب بالنقاط/الإعادة.

على AIsa الحقيقي (`adapters/aisa/agent.ts`): خطة من 4 خطوات؛ خطوة الاكتشاف تجرّب أولًا ما يدّعيه الكتالوج (بحث بلا مفتاح) فتفشل بـ401 كما في التشغيل الحقيقي،
فيعيد الوكيل التخطيط إلى البحث بالمفتاح — إعادة تخطيط حقيقية على دليل حقيقي، ثم `get_details` بوسائط مربوطة من ملاحظة البحث، ثم لقطة الحساب المجانية.

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
| v0.3 GEN-2 Agent Core | intent · context · planner · plan · decision loop · observation · verification · recovery · replan · task/checkpoint/replay | **EXISTS · TESTED · RUNTIME VERIFIED** (وكيل على AIsa في CI؛ `GEN2_GATE runtime=PASS`) |
| v0.4 GEN-3 Task Engine | SQLite store · resume · WAITING_APPROVAL/PARTIAL · approvals → grants · artifacts · replay from store | **EXISTS · TESTED · RUNTIME VERIFIED** (قتل + استئناف حقيقيان في CI؛ `GEN3_GATE runtime=PASS`، الموافقات = tests) |
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
| Human approval (grants) في CI | TESTED فقط | لا منح في CI؛ المسار مُختبَر بمنفّذ وهمي (منح بشري مربوط بالكامل) |
| Agent Core (GEN-2): آلة الحالة · حلقة القرار · إعادة التخطيط · نقاط التفتيش · الإعادة | VERIFIED | `tests/unit/celia-agent.test.ts` + تشغيل CI حقيقي (`GEN2_GATE`) |
| Understanding بنموذج لغوي · Planner بنموذج | NOT_PRESENT (عمدًا) | GEN-2 حتمي بقوالب؛ Model Mesh = GEN-9 |
| Task Engine (GEN-3): SQLite · استئناف · WAITING_APPROVAL · PARTIAL · مخرجات | VERIFIED | `tests/unit/celia-task-engine.test.ts` + قتل/استئناف حقيقيان في CI (`GEN3_GATE`) |
| تدفق الموافقة البشرية عند التشغيل | TESTED فقط | لا إنسان في CI؛ المسار مُختبَر كاملًا (طلب → منح → استهلاك → تدقيق) |
| Skills · Subagents · Workspace · Project Brain · Browser/Computer · Model Mesh · UI · Cloud deploy | NOT_PRESENT / PLANNED | — |

## ما لا يدّعيه هذا المجلد

- لا منفّذ حقيقي غير مزوّد AIsa القرائي المجاني؛ ملفات/طرفية/متصفح/GitHub/`use` مدفوع = غير موجودة، و`DeniedExecutor` هو الافتراضي.
- لا ذاكرة/Project Brain، لا Model Mesh، لا Skill Mesh، لا وكلاء متعددون، لا واجهة، لا نشر سحابي.
- الوكيل يفهم **قالبًا واحدًا** (اكتشاف AIsa) — الفهم قوالب حتمية لا فهم لغوي.
- الموافقات بلا RBAC ولا موافقين متعددين ولا واجهة (API/CLI + مخزن فقط)؛ لا تنفيذ موزّع/متعدد العمّال؛ `approval_flow_verified` في CI = tests لا runtime (لا موافقة بشرية مزيّفة).
- «zero charge delta» من مصدر المزوّد نفسه = عدم‑تناقض، لا إثبات محاسبي مستقل.
- «pre_execution_gate_verified» إثبات **داخل العملية** (عدّاد النقل الخام مقابل تنفيذات البوابة + ترتيب المراحل في الإيصالات)؛
  ليس عزلًا على مستوى الشبكة/نظام التشغيل — ذلك يأتي مع Workspace/Device runtime.
- لا يعدّل هذا الكود نفسه ولا الحوكمة (§13): أي تغيير في `celia/nexa/` يمرّ بمراجعة بشرية كأي كود.
