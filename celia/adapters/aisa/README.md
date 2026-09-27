# AIsa — محوّل قراءة‑فقط محكوم ببوابة NEXA (GEN-1)

> **يقترح ولا ينفّذ إلا ما تأذن به البوابة قبل النداء.** مستقل عن التطبيق: لا يستورده أي ملف في `app/` أو `lib/`
> (`AISA_RUNTIME_INTEGRATION = NOT_PRESENT` عمدًا). الموقع: `celia/adapters/aisa/` — أول «قدرة» في Celia تمرّ عبر
> `nexa/gateway` (انظر [الجسر](#جسر-nexa-bridgets) و[`celia/README.md`](../../README.md)).

## الملفات

| ملف | الدور |
|---|---|
| `adapter.ts` | النقل الخام (بعدّاد نداءات)، قائمة الأدوات المسموحة، تصنيف السعر، مُحقِّق المخطط، سياسة المحوّل، الدليل المنقّح، المستخرجات |
| `provider.ts` | **الطريق الوحيد من البوابة إلى الشبكة**: 4 عمليات مجانية قرائية (`list_categories · search · get_details · use:account`)؛ أي `use:<id>` ⇒ `PAID_USE_DISABLED` قبل الشبكة |
| `pipeline.ts` | خط الأنابيب المحكوم: كل خطوة اقتراح إلى `ExecutionGateway`؛ المرشحون المدفوعون يُقدَّمون فعلًا ويُرفضون قبل المزوّد؛ CLI |
| `bridge.ts` | حكم NEXA offline على مخرجات التشغيل: سلسلة الدليل، الإيصالات، العقد، GEN1_GATE |
| `contract.readonly.json` | عقد النتيجة |
| `goals.ts` | GEN-2: قالب هدف «اكتشاف AIsa» (عقد + استراتيجية 4 خطوات بمرشحين مرتبين) + فكّ الناتج + تصنيف الفشل |
| `agent.ts` | GEN-2/3: تشغيل وكيل Celia على AIsa — تركيب فقط (مزوّد + سجل + بوابة + قوالب + مخزن SQLite + موافقات + وكيل)؛ CLI: `run / resume / approvals / approve / reject` |

## خط الأنابيب

```text
[gateway] use:account → [gateway] search(anonymous) → [gateway] list_categories → [gateway] search → [gateway] get_details
→ adapter policy per candidate → [gateway] use:<candidate> ×N (⇒ DENIED@POLICY/APPROVAL, provider untouched)
→ [gateway] use:account → GATEWAY line + evidence graph (hash-chained, produced during the run)
```

كل `[gateway]` = `CAPABILITY → POLICY(+resources) → AUTHORIZATION → APPROVAL → COST → EXECUTION → OBSERVATION → VERIFICATION → EVIDENCE`.
سطر `GATEWAY:` يطبع `submitted/executed/verified/denied`، و`boundary_calls == transport_calls`، و`ungated_calls=0`، وحالة حارس الموارد
(`aisa.requests` ≤ 20 لكل تشغيل، `aisa.spend_usd` ≤ السقف — حصص ذاتية fail-closed).

| مرحلة | أداة MCP | التكلفة بحسب العقد | ما يُسجَّل في الدليل |
|---|---|---|---|
| connect + authenticate | `list_categories` | مجانية | رمز الحالة، أسماء الحقول، أعداد |
| discovery | `search` | مجانية | `retrieval_mode`، عدد المرشحين، `operation_id`s (عامة) |
| contract | `get_details` | مجانية | `read_only` · `side_effects` · `availability` · تصنيف السعر · الحقول المطلوبة · عدد الـpitfalls |
| proposal + policy | — (بلا شبكة) | — | القرار وأسبابه |
| accounting delta (اختياري) | `use({operation_id:"account"})` | مجانية | أسماء المسارات الرقمية التي تغيّرت + الفروق فقط |

## حدود بنيوية (ليست اتفاقًا)

- قائمة الأدوات المسموحة ثابتة في الكود: `list_categories` · `search` · `get_details`. أي اسم آخر ⇒ `AisaPolicyError(TOOL_NOT_ALLOWED)` **قبل** أي نداء شبكة. النداء الخام غير مُصدَّر.
- الاستثناء المُسمّى الوحيد: `accountSnapshot()` — `use` بـ`operation_id` ثابت `"account"` (مجانية، قراءة‑فقط)؛ لا يقبل معاملات.
- قرار سياسة المحوّل `ADMIT_TO_AUTHORIZATION` = «مقبول للمرور إلى مرحلة التفويض». **ليس تصريح تنفيذ** — سلطة التنفيذ هي بوابة NEXA:

```text
AI/AISA proposes → Policy decides → Authorization permits → Execution Authority executes → Evidence verifies
   (adapter)        (adapter + nexa/policy)   (nexa/authorization: منح بشري)   (nexa/gateway → provider.ts)   (gateway receipts + bridge)
```

- في CI لا توجد منح بشرية ⇒ أي فعل مدفوع يقف عند `POLICY` (سقف 0، توفّر مجهول، تكلفة ديناميكية) أو `APPROVAL` — **قبل** المزوّد.
- قرارات GEN-1 المحسومة: `availability=unknown ⇒ DENY (NEXA_E_AVAILABILITY_UNKNOWN)`؛ `DEFAULT_SPEND_CAP_USD = 0` (رفع السقف = مدخل صريح من المالك في سير العمل، لا افتراض)؛
  أول تنفيذ مدفوع = منح بشري صريح أحادي الاستعمال مربوط بتجزئة الاقتراح والعملية وسقف التكلفة — لا موافقة من AI/وكيل/مخطِّط/مزوّد.

## السياسة (`decide`)

| فحص | القاعدة |
|---|---|
| السعر | `free` أو `fixed ≤ min(policy cap, proposal cap)` ⇒ ضمن السقف · `dynamic`/`unknown` ⇒ **رفض** (وثائق AIsa: لا حدّ أعلى موثّق = لا تنفيذ) |
| القراءة‑فقط | `read_only === true` و`side_effects` فارغة/none — غير المعلن ⇒ رفض |
| التوفر | `availability` = available/live/ok/… — المجهول ⇒ رفض |
| المخطط | مُحقِّق **مجموعة‑جزئية** من JSON Schema (`type · required · properties · additionalProperties · enum/const · items · min/max · minLength/maxLength · anyOf/oneOf`) — يُعلَن `subset` دائمًا؛ لا يُدَّعى تحقق كامل |
| السقف | `proposal.max_price_usd > policy.maxPriceUsd` ⇒ رفض |

## التشغيل

```bash
# محليًا (Node ≥ 22.18، بلا build) — المفتاح من البيئة فقط (adapter.ts يفوّض إلى pipeline.ts)
AISA_API_KEY=… node celia/adapters/aisa/pipeline.ts \
  --query "…" --limit 3 --max-price-usd 0.01 --autofill --account-snapshot \
  --out evidence.txt --json evidence.json

# CI: .github/workflows/aisa-adapter-evidence.yml (السرّ AISA_API_KEY في GitHub Actions)

# حكم NEXA على مخرجات المحوّل (بلا شبكة، بلا سرّ) — الخروج 0 فقط عند COMPLETED
node celia/adapters/aisa/bridge.ts --in evidence.json --graph evidence-graph.jsonl --out nexa.txt
```

`--autofill` يملأ **فقط** الحقول المطلوبة من نوع query/url بقيم معلنة في الدليل (`autofilled=[…]`) لعرض مسار التحقق — ولا يُنفَّذ شيء.

## الدليل (evidence)

- ASCII منقّح: لا مفتاح، لا ترويسات، لا نصوص خام من الردود، لا قيم حساب مطلقة. رموز حالة، أعداد، أسماء حقول، معرّفات عمليات عامة، فروق رقمية.
- بصمة المفتاح **لا تُطبع** هنا (المستودع عام؛ البصمة معرّف ارتباط ثابت).
- سطر `GATE` بمفردات البوابة: `AISA_SECRET_PRESENT · AISA_MCP_AUTH · AISA_SEARCH_ANONYMOUS · AISA_DISCOVERY · AISA_GET_DETAILS · AISA_SCHEMA_VALIDATION · AISA_PRICE_CAP · AISA_PAID_USE · AISA_EXECUTION_AUTHORITY · AISA_RUNTIME_INTEGRATION`.
- `facts.gateway` (إحصاءات + إيصالات منقّحة) و`graph` (رسم دليل البوابة، JSONL بسلسلة تجزئة) في ملف `--json`.

## ملاحظة runtime مقابل الكتالوج

الكتالوج يصف `search` بأنه يعمل بلا مفتاح؛ الخادم ردّ **401** بلا Bearer (2026‑09‑27). يُسجَّل ذلك في الدليل كـ
`AISA_SEARCH_ANONYMOUS=CONTRADICTED_BY_RUNTIME`، والاعتماد في التنفيذ على سلوك الخادم الفعلي: Bearer دائمًا.

## وكيل GEN-2/3 على AIsa (`agent.ts`)

```bash
export NODE_OPTIONS=--disable-warning=ExperimentalWarning   # node:sqlite
AISA_API_KEY=… node celia/adapters/aisa/agent.ts run --goal "discover aisa tools for <query>" --limit 3 --db celia.sqlite [--json out.json]
node celia/adapters/aisa/agent.ts resume --db celia.sqlite --task task:aisa-agent-discover        # من آخر نقطة تفتيش
node celia/adapters/aisa/agent.ts approvals --db celia.sqlite                                     # الطلبات المعلّقة
node celia/adapters/aisa/agent.ts approve --db celia.sqlite --approval <id> --by "<human>"        # ⇒ منح أحادي الاستعمال ثم resume
node celia/core/agent/replay.ts --db celia.sqlite --task task:aisa-agent-discover                 # offline: GEN2_GATE + GEN3_GATE من المخزن نفسه
```

```text
UNDERSTAND  template:aisa-discover ⇒ contract required=[mcp_auth_verified, discovery_verified, get_details_verified, account_snapshot_verified]
                                          forbidden=[paid_use, ungated_action, secret_exposure] blockers=[secret_absent]
PLAN v1     authenticate=[aisa:list_categories]  discover=[aisa:search(anonymous) | aisa:search]  details=[aisa:get_details ← $bind discover.candidates[*].operation_id]  account=[aisa:use:account]
RUN         act-1 list_categories VERIFIED → act-2 search(anonymous) 401 ⇒ FAILED ⇒ RECOVERING ⇒ REPLANNING ⇒ PLAN v2 → act-3 search VERIFIED → act-4 get_details VERIFIED → act-5 use:account VERIFIED
ARTIFACTS   candidate-operation-ids · detailed-operation-ids · declared-prices · declared-availability (من خطوات VERIFIED فقط، بتجزئة)
VERIFY      contract ⇒ COMPLETED · GEN2_GATE runtime=PASS · GEN3_GATE runtime=PASS (approval_flow_verified=tests)
```

- الخروج: `0` COMPLETED · `3` WAITING_APPROVAL (قرار بشري مطلوب ثم `resume`) · `1` غير ذلك. غياب المفتاح ⇒ `BLOCKER: secret_absent` قبل أي تخطيط أو نداء.
- `CELIA_CRASH_AT=<STATE>:<n>` يقتل العملية (SIGKILL) بعد التزام الانتقال رقم n — يستخدمه سير العمل لإثبات الاستئناف على AIsa الحقيقي: عملية 1 تُقتل بعد `EXECUTING` الثالث، عملية 2 تستأنف من الملف وتسجّل المحاولة `INTERRUPTED` وتعيد القراءة وتكمل.
- سطور الدليل أسماء ومعرّفات وعدّادات فقط؛ بيانات الخطوات تُسلسل كأشكال، والمخرجات في التقرير بلا بيانات (البيانات في المخزن).

## جسر NEXA (`bridge.ts`)

يقرأ JSON خط الأنابيب بعد التشغيل ولا يتصل بأي شبكة:

| ما يفعله | الناتج |
|---|---|
| يستورد رسم دليل البوابة ويتحقق من سلسلة تجزئته؛ تلاعب ⇒ `runtime_evidence_tampered=true` ⇒ FAILED | `NEXA_EVIDENCE runtime_chain=ok(N)` |
| يثبت البوابة القبلية: `transport_calls == boundary_calls == executed`، `ungated_calls=0`، وترتيب المراحل في كل إيصال مُنفَّذ | `NEXA_GATEWAY … ordered_receipts=yes` |
| يشتقّ حقائق من `facts.gate`/`facts.gateway`/السطور — الغائب = `"unknown"` لا `false` | `NEXA_FACTS …` |
| يحكم بعقد النتيجة [`contract.readonly.json`](./contract.readonly.json) | `NEXA_OUTCOME=COMPLETED / PARTIAL / BLOCKED / NOT_VERIFIED / FAILED` |
| يحسب الجزء الزمني من GEN1_GATE (tests_pass = CI) | `NEXA_GEN1_GATE runtime=PASS/FAIL/NOT_VERIFIED` |
| يرفع سلّم قدرة `aisa` بدليل إيصال `list_categories`: `CAN → AVAILABLE` — لا أبعد | `NEXA_CAPABILITY aisa=AVAILABLE evidence=action:act-3` |
| يعرض مصير المرشحين المدفوعين في البوابة | `NEXA_PROPOSALS post_x:DENIED@POLICY(DENY) …` |

عقد النتيجة: **مطلوب** `pre_execution_gate_verified · mcp_auth_verified · discovery_verified · get_details_verified · use_restricted_to_account · zero_charge_delta` ·
**ممنوع** `paid_use · secret_exposure · runtime_evidence_tampered` · **عائق** `secret_absent` (⇒ BLOCKED لا FAILED).

`zero_charge_delta` يعني: لا مسار **نقدي** (usd/balance/credit/wallet/spend/cost/charge/amount/price) تغيّر بين اللقطتين؛ عدّادات النداءات
(`today_calls`) تتحرك بنداءاتنا المجانية ولا تُعدّ رسمًا. هذا **ليس** إثباتًا محاسبيًا مستقلًا — هو عدم‑تناقض من مصدر المزوّد نفسه.

> GEN-1: NEXA يحكم **قبل** كل نداء (البوابة داخل العملية). إثبات البوابة القبلية داخلي للعملية (عدّادات + إيصالات + سلسلة)، لا عزل شبكي/نظامي — ذلك مع Workspace/Device runtime لاحقًا.

## الاختبارات

- `tests/unit/aisa-adapter.test.ts` — allowlist قبل الشبكة، `accountSnapshot` الثابت، SSE، تصنيف السعر، مُحقِّق المخطط،
  قرارات السياسة، نظافة الدليل، المزوّد (paid use معطّل بنيويًا)، وخط الأنابيب المحكوم الكامل بشبكة وهمية
  (`submitted=8 executed=6 … ungated_calls=0`، المرشحون مرفوضون عند POLICY/APPROVAL).
- `tests/unit/celia-gateway.test.ts` — البوابة قاعدةً قاعدة: unknown capability/provider، سياسة، منح أحادية، حجز/تسوية، فشل الحدّ، حارس الموارد.
- `tests/unit/celia-aisa-agent.test.ts` — الوكيل على AIsa بشبكة وهمية: فهم الهدف، 4 خطوات، فشل البحث المجهول ⇒ إعادة تخطيط حقيقية ⇒ COMPLETED؛ بلا مفتاح ⇒ BLOCKED قبل أي نداء؛ لا تسريب.
- `tests/unit/celia-task-engine.test.ts` — GEN-3: قتل/استئناف على ملف SQLite، WAITING_APPROVAL → موافقة/رفض/انتهاء/تلاعب، PARTIAL لا COMPLETED، مخرجات، مخازن ومعاملات.
- `tests/unit/celia-aisa-bridge.test.ts` — خط الأنابيب → الجسر ⇒ COMPLETED + `GEN1 runtime=PASS`؛ تلاعب برسم الـruntime ⇒ FAILED؛
  إيصال يدّعي تنفيذًا مدفوعًا ⇒ FAILED؛ نداء خارج البوابة ⇒ PARTIAL؛ شكل GEN-0 ⇒ NOT_VERIFIED؛ غياب السرّ ⇒ BLOCKED.
