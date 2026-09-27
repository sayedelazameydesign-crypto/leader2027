# AIsa — محوّل قراءة‑فقط (read-only adapter)

> **يقترح ولا ينفّذ.** مستقل عن التطبيق: لا يستورده أي ملف في `app/` أو `lib/`
> (`AISA_RUNTIME_INTEGRATION = NOT_PRESENT` عمدًا). الموقع: `celia/adapters/aisa/` — أول «قدرة» في Celia،
> ودليله هو أول ما يحكم عليه NEXA (انظر [الجسر](#جسر-nexa-bridgets) و[`celia/README.md`](../../README.md)).

## خط الأنابيب

```text
connect → authenticate → list/search → get_details → validate schema → enforce max_price_usd → emit evidence
```

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
- قرار السياسة `ADMIT_TO_AUTHORIZATION` = «مقبول للمرور إلى مرحلة التفويض». **ليس تصريح تنفيذ** — التنفيذ سلطة منفصلة:

```text
AI/AISA proposes → Policy decides → Authorization permits → Execution Authority executes → Evidence verifies
       (هنا)           (هنا)             (ليس هنا)                 (ليس هنا)                   (هنا)
```

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
# محليًا (Node ≥ 22.18، بلا build) — المفتاح من البيئة فقط
AISA_API_KEY=… node celia/adapters/aisa/adapter.ts \
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
- سطر `GATE` بمفردات البوابة: `AISA_SECRET_PRESENT · AISA_MCP_AUTH · AISA_SEARCH_ANONYMOUS · AISA_DISCOVERY · AISA_GET_DETAILS · AISA_SCHEMA_VALIDATION · AISA_PRICE_CAP · AISA_PAID_USE · AISA_RUNTIME_INTEGRATION`.

## ملاحظة runtime مقابل الكتالوج

الكتالوج يصف `search` بأنه يعمل بلا مفتاح؛ الخادم ردّ **401** بلا Bearer (2026‑09‑27). يُسجَّل ذلك في الدليل كـ
`AISA_SEARCH_ANONYMOUS=CONTRADICTED_BY_RUNTIME`، والاعتماد في التنفيذ على سلوك الخادم الفعلي: Bearer دائمًا.

## جسر NEXA (`bridge.ts`)

يقرأ JSON المحوّل بعد التشغيل ولا يتصل بأي شبكة، ويطبّق عليه حوكمة Celia (`celia/nexa/`):

| ما يفعله | الناتج |
|---|---|
| يشتقّ حقائق من `facts.gate` وسطور الدليل — الغائب = `"unknown"` لا `false` | `NEXA_FACTS …` |
| يحكم بعقد النتيجة [`contract.readonly.json`](./contract.readonly.json) | `NEXA_OUTCOME=COMPLETED / PARTIAL / BLOCKED / NOT_VERIFIED / FAILED` |
| يرفع سلّم قدرة `aisa` بدليل المصادقة فقط: `CAN → AVAILABLE` — **لا يتجاوزها في GEN-0** | `NEXA_CAPABILITY aisa=AVAILABLE evidence=evidence:auth` |
| يمرّر اقتراحات المحوّل الحقيقية على سياسة NEXA ويثبت أن لا شيء مفوَّض (لا منح) | `NEXA_POLICY …/authorized=no` |
| يبني رسم دليل إلحاقيًا بسلسلة تجزئة (JSONL) قابلًا لإعادة التشغيل | `NEXA_EVIDENCE nodes=… chain=ok head=…` |

عقد النتيجة: **مطلوب** `mcp_auth_verified · discovery_verified · get_details_verified · use_restricted_to_account · zero_charge_delta` ·
**ممنوع** `paid_use · secret_exposure` · **عائق** `secret_absent` (⇒ BLOCKED لا FAILED).

`zero_charge_delta` يعني: لا مسار **نقدي** (usd/balance/credit/wallet/spend/cost/charge/amount/price) تغيّر بين اللقطتين؛ عدّادات النداءات
(`today_calls`) تتحرك بنداءاتنا المجانية ولا تُعدّ رسمًا. هذا **ليس** إثباتًا محاسبيًا مستقلًا — هو عدم‑تناقض من مصدر المزوّد نفسه.

> GEN-0: NEXA يحكم **بعد** التنفيذ (المحوّل نفّذ نداءات القراءة بمنفّذه الخاص). في GEN-1 يمرّ المحوّل عبر حدّ التنفيذ **قبل** أي نداء.

## الاختبارات

- `tests/unit/aisa-adapter.test.ts` — allowlist قبل الشبكة، `accountSnapshot` الثابت، SSE، تصنيف السعر، مُحقِّق المخطط،
  قرارات السياسة، نظافة الدليل (لا تسرّب للمفتاح)، وخط الأنابيب الكامل بشبكة وهمية.
- `tests/unit/celia-aisa-bridge.test.ts` — خط الأنابيب الوهمي → الجسر ⇒ COMPLETED؛ دليل معدَّل يدّعي `use` مدفوعًا ⇒ FAILED؛
  غياب ACCOUNT/USE ⇒ NOT_VERIFIED؛ غياب السرّ ⇒ BLOCKED وسلّم `CAN`؛ فرق نقدي ⇒ PARTIAL؛ مفتاح في الدليل ⇒ FAILED.
