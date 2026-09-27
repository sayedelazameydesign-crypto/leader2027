# GEN-3 Task Engine — Design Spec + مطابقة التنفيذ

> **الحالة:** مُنفَّذ ومُختبَر ومُثبَت بتشغيل حقيقي — commit `6aeb41f`، تشغيل `aisa-adapter-evidence.yml` رقم 36298899184 (قتل SIGKILL حقيقي للعملية أثناء EXECUTING ثم استئناف من ملف SQLite)، و`ci.yml` رقم 36298899186 (321 اختبارًا).
> القسم الأول هو المواصفة كما وردت (بلا تعديل). القسم الثاني يربط كل بند بما يقابله في الكود والاختبارات والدليل، ويعلن الفروق صراحةً.

---

## الجزء الأول — المواصفة (كما وردت)

**الهدف:** تحويل المهمة من in-memory/JSONL (GEN-2) لكيان دائم يفضل موجود عبر إعادة التشغيل، مع توقف حقيقي (WAITING_APPROVAL) بدل فشل السير كله.

### 1) نموذج البيانات

```json
{
  "Task": {"id":"", "goal":"", "status":"", "checkpointHead":"", "evidenceChainHead":"", "createdAt":"", "updatedAt":""},
  "ApprovalRequest": {"id":"", "taskId":"", "stepId":"", "proposalHash":"", "operation":"", "costCap":0, "status":"pending|approved|rejected|expired", "expiresAt":"", "decidedBy":""},
  "Artifact": {"id":"", "taskId":"", "stepId":"", "type":"", "ref":"", "evidenceHash":""}
}
```

Checkpoint نفسه (GEN-2: hash-chained + رأس دليل) بيتمدّد بس، مش بيتغيّر.

### 2) آلة الحالة الموسّعة

```text
CREATED>UNDERSTANDING>PLANNING>READY>EXECUTING>OBSERVING>VERIFYING
  VERIFYING ⇒ {COMPLETED | PARTIAL | RECOVERING>REPLANNING>READY..}
  PLANNING|READY ⇒ WAITING_APPROVAL ⇒ {READY | BLOCKED | REPLANNING}
```

### 3) قواعد الشرعية البنائية (امتداد لقاعدة GEN-2 "PLANNING→COMPLETED مستحيل بنيويًا")

- `WAITING_APPROVAL`: من PLANNING/READY فقط، قبل EXECUTING — أبدًا من VERIFYING/COMPLETED
- استئناف `WAITING_APPROVAL` يعيد تحقق تطابق `proposalHash+operation+costCap` قبل الرجوع READY — عدم تطابق ⇒ DENY فوري (نفس §1/§2 NEXA)
- `PARTIAL`: من VERIFYING فقط — نفس سلطة COMPLETED (حكم العقد لا الوكيل)
- `BLOCKED`: نهائي، بلا auto-retry بعد الدخول (يطابق "رفض NEXA لا يُعاد أبدًا" في GEN-2)

### 4) الاستمرارية (persistence)

- استبدال memory/JSONL بمخزن حقيقي (SQLite — تويس تير مجاني)
- checkpoints تفضل مسلسلة بالتجزئة + رأس دليل زي GEN-2 بالظبط
- استئناف: تحميل آخر checkpoint بـ `taskId` → إعادة تشغيل سلسلة التجزئة (منطق GEN2_REPLAY نفسه) → إعادة بناء السياق → رجوع لنفس الحالة المسجَّلة

### 5) Approvals = منح بشرية معلّقة

- دخول `WAITING_APPROVAL` ⇒ تخزين `ApprovalRequest` أعلاه
- موافقة (human فقط، §3) ⇒ توليد Grant أحادي الاستعمال بنفس شكل NEXA §3 ⇒ READY
- رفض/انتهاء صلاحية ⇒ fail-closed ⇒ REPLANNING لو فيه بديل، وإلا BLOCKED
- ده نفس نمط ApprovalStore المبني قبل كده في gethip_agen (pending/approved/rejected/expired + TTL + audit log) — GEN-3 يوصّله بحلقة الوكيل بدل ما يفضل منفصل

### 6) Artifacts

- تتولّد من خطوات VERIFIED بس (نفس قاعدة GEN-2)
- كل artifact مربوط بـ `stepId + evidenceHash` → يدخل نفس سلسلة السلامة
- متاحة حتى لو المهمة PARTIAL أو BLOCKED — مش مربوطة بـ COMPLETED بس

### 7) GEN3_GATE (تقرير قبول مقترح)

```text
GEN3_GATE  runtime=PASS persistence_verified=true resume_verified=true
           approval_flow_verified=true partial_verified=true
           artifacts_verified=true tests_pass=ci
```

### 8) الاختبارات الحاسمة (4، امتداد لـ3 GEN-2)

1. قتل العملية أثناء EXECUTING → إعادة تشغيل → استئناف من checkpoint → نفس نتيجة التشغيل المتواصل
2. خطوة تحتاج `NEXA_A_PAID` بلا منح → WAITING_APPROVAL → موافقة → استئناف → COMPLETED
3. نفس السيناريو + رفض → BLOCKED أو REPLANNING (أبدًا استمرار صامت)
4. عقد النتيجة يتحقق جزئيًا وما فيش بدائل تانية ⇒ PARTIAL، أبدًا COMPLETED

### 9) خارج نطاق GEN-3

- لا RBAC/موافقين متعددين — نفس قيد ApprovalStore الحالي (shared token، مش OAuth)
- لا تنفيذ موزّع/multi-worker (ده الـdistributed runtime المنفصل)
- لا UI للموافقات — API/store بس

---

## الجزء الثاني — مطابقة التنفيذ (بند ← كود ← اختبار ← دليل)

| بند | التنفيذ | الاختبار | دليل التشغيل |
|---|---|---|---|
| §1 `Task` | `core/task/task.ts`: `state` (= `status`)، `checkpointHead`، `evidenceChainHead`، `createdAt/updatedAt` + `artifacts`، `approvals`، `pendingApprovalId`، `processes` (لكل عملية: `executed` مقابل `transportCalls`) | `celia-task-engine.test.ts` «round-trips every record type» | `PROCESSES: 1:run[CREATED>?] executed=2 transport=2 2:resume[EXECUTING>COMPLETED] executed=3 transport=3` |
| §1 `ApprovalRequest` | `core/task/approval.ts`: كل الحقول المطلوبة + `capability`، `risk`، `reason`، `requestedAt`، `decidedAt`، `decision`، `grantId` | «decisive test 2/3» | — (لا موافقة بشرية في CI) |
| §1 `Artifact` | `core/task/artifact.ts`: كل الحقول المطلوبة + `evidenceHead`، `createdAt`، `data` (في المخزن فقط؛ التقرير العام بلا بيانات) | «decisive test 4»، `verifyArtifact` | `artifacts=4` في `GEN2_REPLAY`؛ `artifacts_verified=true` |
| §1 Checkpoint امتدّ ولم يتغيّر | `core/task/checkpoint.ts` بلا تغيير في الشكل؛ يُكتب الآن في المخزن عبر `StoreCheckpoints` | `verifyCheckpoints` (اختبارات GEN-2 كما هي) | `checkpoints=32 chain=ok heads_linked=yes` |
| §2 الآلة الموسّعة | `core/task/task-state.ts`: `TASK_TRANSITIONS` + `WAITING_APPROVAL` + `PARTIAL`؛ `TERMINAL_STATES = COMPLETED/PARTIAL/BLOCKED/FAILED` | «WAITING_APPROVAL only from PLANNING/READY; PARTIAL only from VERIFYING» | `STATES: …>VERIFYING>COMPLETED` |
| §3 WAITING_APPROVAL قبل EXECUTING | `core/agent/decision-loop.ts` (حالة READY): `gateway.precheck()` استشاري ⇒ إن احتاج منحًا ⇒ `ApprovalService.request` ⇒ WAITING_APPROVAL. `nexa/gateway.ts#precheck` بلا تنفيذ/حجز/دليل | «decisive test 2» (`p1.calls` بلا `paid`) | — |
| §3 إعادة تحقق التطابق عند الاستئناف | حالة WAITING_APPROVAL: `pre.proposalHash === a.proposalHash && operation && maxCostUsd ≤ costCap` وإلا `approval.mismatch` ⇒ DENIED@APPROVAL ⇒ REPLANNING | «tampered approval binding ⇒ denied on resume» | — |
| §3 PARTIAL من VERIFYING فقط | حالة VERIFYING بلا خطوة جارية ⇒ `finalState()` من حكم العقد (`evaluateOutcome`) | «decisive test 4»، GEN-2 scenario 2 (محدَّث) | `partial_verified=true` (اتساق الحالة النهائية مع حكم العقد) |
| §3 BLOCKED نهائي | `TASK_TRANSITIONS.BLOCKED = []`؛ `decideRecovery` لا يعيد اقتراحًا رفضته NEXA | «terminal states are final» | — |
| §4 SQLite | `core/task/sqlite-store.ts` فوق `node:sqlite` المدمج (بلا تبعيات؛ `BEGIN IMMEDIATE` لكل انتقال: نقطة تفتيش + دليل + لقطة) و`core/task/store.ts` (الواجهة `TaskStore` + `MemoryTaskStore`) | «SqliteTaskStore round-trips…rolls back» | ملف `/tmp/celia.sqlite` حمل المهمة بين عمليتين على الـrunner |
| §4 الاستئناف | `core/agent/agent.ts#loadTaskForResume`: سلسلة النقاط + سلسلة الدليل + ربط الرؤوس + لقطة المهمة ⇒ وإلا `RESUME_INTEGRITY`؛ البوابة تُبنى فوق الرسم المحفوظ (`startSeq`)؛ الحلقة تكمل من الحالة المسجَّلة؛ انقطاع بعد EXECUTING = محاولة `INTERRUPTED` (القراءة تُعاد، غير القراءة fail-closed) | «decisive test 1» (SIGKILL محاكى على ملف SQLite حقيقي + مقارنة بتشغيل متواصل + رفض نسخة متلاعَب بها) | `CRASH_INJECTED … EXECUTING #3` · `PROCESS_1 exit=137` · `resume_verified=true` |
| §5 الموافقات | `ApprovalService`: `request/approve/reject/expireDue` + TTL + سجل تدقيق (`approval.requested/approved/rejected/expired/resumed/mismatch`)؛ `approve` إنسان فقط ⇒ Grant أحادي الاستعمال مربوط بـ proposalHash + operation + costCap (شكل NEXA §3 نفسه) | «decisive test 2» (`basis=grant`، المنح مستهلك)، «decisive test 3» (رفض/انتهاء/تلاعب/موافقة مكرّرة) | `approval_flow_verified=tests` — انظر الفروق |
| §6 المخرجات | `PlanStep.artifacts` تصريحية؛ تُولَّد في VERIFYING عند VERIFIED فقط؛ `makeArtifact` يربط `stepId + ref(actionId) + evidenceHead` بتجزئة قابلة للإعادة؛ تُحفظ في المخزن وتبقى في PARTIAL/BLOCKED | «decisive test 4» | `ARTIFACT …:discover:candidate-operation-ids … hash=…` (4 مخرجات) |
| §7 GEN3_GATE | `core/agent/replay.ts#assessGen3` — يُحسب من المخزن نفسه (`--db … --task …`) | اختبارات `replayFromStore` | `GEN3_GATE runtime=PASS persistence_verified=true resume_verified=true approval_flow_verified=tests partial_verified=true artifacts_verified=true tests_pass=ci` |
| §8 الاختبارات الأربعة | `tests/unit/celia-task-engine.test.ts` | 8 اختبارات (الأربعة الحاسمة + جدول الحالات + المخازن) | — |
| §9 خارج النطاق | لا RBAC (اسم حر + `principal: "human"`)، لا توزيع، لا واجهة (CLI: `approvals / approve / reject`) | — | — |

### كيف يعمل على AIsa الحقيقي (CI)

```text
step 7  node celia/adapters/aisa/agent.ts run --goal … --db /tmp/celia.sqlite        (CELIA_CRASH_AT=EXECUTING:3 ⇒ SIGKILL بعد التزام الانتقال الثالث؛ exit 137)
step 8  node celia/adapters/aisa/agent.ts resume --db /tmp/celia.sqlite --task task:aisa-agent-discover
step 9  node celia/core/agent/replay.ts --db /tmp/celia.sqlite --task task:aisa-agent-discover   (GEN2_GATE + GEN3_GATE من المخزن)
```

### الفروق المُعلَنة عن المواصفة (قرارات تصميم — قابلة للمراجعة)

1. **`approval_flow_verified=tests` في CI لا `true`.** التدفق كامل ومُختبَر (طلب → منح بشري → استهلاك → تدقيق → استئناف)، لكن ممارسته وقت التشغيل تتطلب إنسانًا؛ رفضتُ أن يوافق الـrunner «نيابةً» عن الإنسان لأن ذلك يخالف §3 نفسه. القيمة `tests` تعني: مُثبَت بالاختبارات التي يشهد لها `tests_pass=ci`.
2. **خطوة بلا بديل ⇒ تُحجب (ومن يعتمد عليها) وتُكمل الحلقة ما تبقّى، ثم يحكم العقد.** المواصفة تقول «وإلا BLOCKED»؛ التطبيق يجعل الحكم النهائي للعقد في VERIFYING: PARTIAL إن ثبت شيء، BLOCKED إن لم يفشل شيء ولم يثبت شيء، FAILED إن فشل تنفيذ فعلًا. النتيجة نفسها fail-closed، لكن السلطة تبقى للعقد لا للحلقة (تطبيقًا لقاعدة PARTIAL في §3). أثره: سيناريو GEN-2 الثاني صار ينتهي `PARTIAL` بدل `BLOCKED`.
3. **مرشح بلا `maxCostUsd` = 0 دائمًا** (سقف الوكيل `defaults.maxCostUsd` حدّ أعلى لما يجوز للمرشح أن يعلنه، لا قيمة افتراضية له) — امتداد مباشر لقرار GEN-1 §2.
4. **الفحص القبلي استشاري.** `gateway.precheck` يقرر فقط «هل نقف في WAITING_APPROVAL؟»؛ القرار الملزم يبقى في `gateway.submit` الذي يعيد كل التقييم، فلا يمكن للفحص القبلي أن يتجاوز شيئًا.
5. **انقطاع فعل غير قرائي لا يُعاد تلقائيًا** (FAILED مع طلب تسوية يدوية) — لا وجود له اليوم (كل قدرات AIsa قرائية) لكنه مُحكم مسبقًا.
6. **`PLANNING → WAITING_APPROVAL` مشروع في الجدول لكنه غير مستخدم** في GEN-3 (الفحص القبلي يحدث عند READY قبل كل خطوة).
