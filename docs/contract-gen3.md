# عقد GEN-3 — محرك المهام الدائم (Durable Task Engine)

> **الحالة: LOCKED قبل التنفيذ** — أي تنفيذ خارج هذا العقد يُردّ. المنبع: مواصفة GEN-3 (مهمة دائمة + توقف حقيقي `WAITING_APPROVAL`).
> **القرارات المُثبَّتة من المالك:** التخزين عبر `Store` الحالي (`memory/file/postgres`) لا SQLite منفصل · المحرك في `lib/tasks` مستقلًا لا نواة تاسعة.

---

## 1. الهدف في سطر

تحويل المهمة من كيان in-memory/JSONL (GEN-2) إلى **كيان دائم يبقى عبر إعادة التشغيل**، مع **توقف حقيقي** (`WAITING_APPROVAL`) بدل فشل السير كله.

---

## 2. النطاق

### داخل النطاق

| البند | الوصف |
| --- | --- |
| **آلة الحالة الموسّعة** | `CREATED…VERIFYING` + `WAITING_APPROVAL` + `PARTIAL` + `BLOCKED` — انتقالات شرعية بنيويًا فقط |
| **الاستمرارية** | المهام + checkpoints + الموافقات + المنح + artifacts داخل `Store` — تصمد عبر إعادة التشغيل على `file` و`postgres` |
| **Checkpoints مسلسلة بالتجزئة** | امتداد GEN-2 حرفيًا: `prevHash → hash` + رأس دليل `evidenceChainHead` — تُمدَّد ولا تتغيّر |
| **الاستئناف** | تحميل آخر checkpoint بـ`taskId` → إعادة تشغيل سلسلة التجزئة (منطق `GEN2_REPLAY` نفسه) → إعادة بناء السياق → نفس الحالة المسجَّلة |
| **الموافقات المعلَّقة** | دخول `WAITING_APPROVAL` ⇒ تخزين `ApprovalRequest` · موافقة بشرية ⇒ Grant أحادي الاستعمال ⇒ `READY` · رفض/انتهاء ⇒ fail-closed |
| **Artifacts** | من خطوات `VERIFIED` فقط، مربوطة بـ`stepId + evidenceHash`، متاحة حتى لو `PARTIAL`/`BLOCKED` |
| **سطح API/store** | مسارات `/api/tasks/**` للقراءة والإنشاء وطلب/قرار الموافقة والاستئناف — بلا UI |
| **GEN3_GATE** | تقرير قبول ذاتي من المحرك نفسه (لا ادعاء بلا إثبات) |

### خارج النطاق (صراحة)

- ❌ RBAC/موافقون متعددون — قرار واحد بشري (`users:manage`)، بلا OAuth
- ❌ تنفيذ موزّع/multi-worker (مسار الـdistributed runtime المنفصل)
- ❌ UI للموافقات — API/store فقط
- ❌ نواة ذرية تاسعة — الأنوية تبقى **8** والكتالوج **27 أداة** (المحرك `lib/tasks` مستقل)
- ❌ تغيير `Repository Interface` القائم — **توسيع بإضافة** (`tasks`) لا تعديل دلالات
- ❌ SQLite منفصل — انظر القرار D1

---

## 3. قرارات معمارية مُثبَّتة

1. **D1 — الاستمرارية عبر `Store` لا SQLite خام:** نص المواصفة يقترح SQLite (فئة مجانية). لكن القرص على Vercel serverless **ephemeral** — ملف SQLite يموت مع أول إعادة نشر، وهي نفس علة `file` التي حلّها محوّل PostgreSQL (VS5/T1). القرار المعتمد: `tasks` امتداد داخل `Store` ⇒ يعمل تلقائيًا على `memory/file/postgres` بنفس دلالات write-through، والديمومة الحقيقية على Postgres. لا اعتماديات أصلية (native) جديدة.
2. **D2 — المحرك مستقل عن النواة:** `lib/tasks/` بجانب `lib/domain/` — يستهلك `Repos` فقط. لا استيراد من `lib/kernel` ولا من `lib/cells` (العزل قبل الذكاء). التوصيل بحلقة الوكيل يتم عبر API/store لا عبر قدرة نواة.
3. **D3 — الموافقات بنفس نمط البوابة القائمة:** `pending/approved/rejected/expired` + TTL + سجل تدقيق — أي `ApprovalGate` (VS4) هو المرجع السلوكي، وGEN-3 يوصّل هذا النمط بحلقة المهام بدل بقائه منفصلًا.
4. **D4 — القرار بشري حصرًا:** `decideApproval` يرفض أي فاعل غير بشري (`kind !== "human"`)، ومسار القرار يتطلب `users:manage` — نفس سلطة `ai.grant_approval`.
5. **D5 — المحرك متزامن:** كل طرق `TaskEngine` متزامنة كـ`Repos` — بلا `async` وبلا تنفيذ فعلي لخطوات خارجية. «التنفيذ» = تسجيل نتائج يقرّرها المنظّم/العقد، والمحرك يحرس الشرعية والسلامة والاستمرارية.
6. **D6 — المقترح لا يُخزَّن خامًا:** `ApprovalRequest` يحمل `proposalHash` فقط (بصمة SHA-256 للمقترح القانوني) — لا أسرار ولا حمولات حساسة في المخزن (نفس روح `sanitize` في النواة).

---

## 4. نموذج البيانات

الشكل الأدنى من المواصفة (يُحفَظ حرفيًا) + حقول موسِّعة موثّقة هنا:

```json
{
  "Task": {"id":"", "goal":"", "status":"", "checkpointHead":"", "evidenceChainHead":"", "createdAt":"", "updatedAt":""},
  "ApprovalRequest": {"id":"", "taskId":"", "stepId":"", "proposalHash":"", "operation":"", "costCap":0, "status":"pending|approved|rejected|expired", "expiresAt":"", "decidedBy":""},
  "Artifact": {"id":"", "taskId":"", "stepId":"", "type":"", "ref":"", "evidenceHash":""}
}
```

| الامتداد | الحقل | السبب |
| --- | --- | --- |
| `Task.plan` | خطوات `{id, operation, costCap, requiresApproval, status}` | الخطة جزء من الكيان الدائم — الاستئناف يعيدها من المخزن لا من الذاكرة |
| `TaskGrant` | `{id, approvalId, taskId, stepId, proposalHash, operation, costCap, consumedAt}` | المنح الأحادي (نظير NEXA §3): يُستهلك مرة واحدة عند الاستئناف |
| `Checkpoint` | `{id, taskId, seq, state, stepId, context, prevHash, hash, evidenceHead, at}` | امتداد GEN-2: نفس التجزئة المتسلسلة + رأس الدليل |
| `ApprovalRequest.decidedAt` | طابع القرار | أثر تدقيقي (القرار نفسه في `audit` أيضًا) |

---

## 5. آلة الحالة

```
CREATED → UNDERSTANDING → PLANNING → READY → EXECUTING → OBSERVING → VERIFYING
  VERIFYING ⇒ { COMPLETED | PARTIAL | RECOVERING → REPLANNING → READY … }
  PLANNING | READY ⇒ WAITING_APPROVAL ⇒ { READY | BLOCKED | REPLANNING }
  OBSERVING ⇒ { VERIFYING (اكتملت الخطوات) | READY (بقيت خطوات: الحلقة) }
```

> امتداد الحلقة: الحكم على خطوة وبقاء أخريات يعيد لـ`READY` لا لـ`EXECUTING` مباشرة —
> المرور بـ`READY` يُبقي طلب الموافقة mid-plan شرعيًا (R1)، و`OBSERVING → EXECUTING` مرفوض.

### قواعد الشرعية البنائية (امتداد لقاعدة GEN-2: `PLANNING → COMPLETED` مستحيل بنيويًا)

- **R1:** `WAITING_APPROVAL` من `PLANNING`/`READY` فقط — قبل `EXECUTING`. أبدًا من `VERIFYING`/`COMPLETED` (ولا من `EXECUTING`/`OBSERVING`).
- **R2:** استئناف `WAITING_APPROVAL` يعيد تحقق تطابق `proposalHash + operation + costCap` قبل الرجوع `READY` — عدم تطابق ⇒ **DENY فوري** بلا انتقال حالة (fail-closed).
- **R3:** `PARTIAL` من `VERIFYING` فقط — وبنفس سلطة `COMPLETED`: **حكم العقد لا الوكيل** (يقرّره `conclude` بدلالة العقد، لا المنظّم).
- **R4:** `BLOCKED` نهائي — بلا auto-retry بعد الدخول (يطابق «رفض NEXA لا يُعاد أبدًا»): أي `resume`/`advance` على `BLOCKED` ⇒ رفض صريح.
- **R5:** `COMPLETED`/`PARTIAL` نهائيتان — لا خروج منهما.
- **R6:** `READY → EXECUTING` لخطوة تتطلب منحًا (`requiresApproval` أو `NEXA_A_PAID`) بلا منح مُستهلك مطابق ⇒ رفض `NEEDS_APPROVAL` — أبدًا استمرار صامت.

---

## 6. Checkpoints والسلامة (امتداد GEN-2)

- كل انتقال حالة يُلحق checkpoint: `seq` متسلسل، `hash = sha256(prevHash | taskId | seq | state | stepId | context | evidenceHead | at)`، الجذر `GENESIS`.
- `Task.checkpointHead` = تجزئة آخر checkpoint. `verifyChain(taskId)` يعيد حساب السلسلة كاملة — أي عبث (تعديل/حذف/إعادة ترتيب) ⇒ `false` ⇒ الاستئناف مرفوض (fail-closed).
- `GEN2_REPLAY` نفسه: `replay(taskId)` = تحقّق السلسلة → دمج السياقات بالترتيب → إرجاع السياق + الحالة المسجَّلة. القتل أثناء `EXECUTING` ثم الاستئناف ⇒ **نفس نتيجة التشغيل المتواصل** (حالة + `evidenceChainHead` + artifacts).
- سلسلة الدليل: كل خطوة `verified` تمدّد `evidenceHash = sha256(prevHead | stepId | evidence)` ويُحدَّث `Task.evidenceChainHead`.

---

## 7. الموافقات والمنح

```
خطوة مدفوعة بلا منح ──▶ WAITING_APPROVAL (+ ApprovalRequest pending, TTL)
   │ موافقة بشرية (users:manage) ──▶ Grant أحادي ──▶ resume (تحقق R2) ──▶ READY
   │ رفض/انتهاء ──▶ fail-closed ──▶ REPLANNING (بديل متاح) أو BLOCKED (لا بديل)
```

- TTL افتراضي 15 دقيقة (نفس `ApprovalGate`)، قابل للحقن في الاختبارات. المنتهي ⇒ `expired` ⇒ نفس مسار الرفض.
- المنح يُستهلك عند أول `resume` ناجح — إعادة الاستعمال ⇒ DENY (نظير `consume` الأحادي).
- القرار يُكتب في `audit` (`task.approval.granted/denied`) مع `decidedBy` — سلسلة مساءلة كاملة.

---

## 8. Artifacts

- تُسجَّل من خطوات `verified` فقط — أي محاولة من خطوة `failed/pending` ⇒ رفض صريح.
- كل artifact مربوط بـ`stepId + evidenceHash` ⇒ داخل سلسلة السلامة نفسها.
- القراءة غير مقيَّدة بالحالة النهائية: متاحة لـ`COMPLETED` و`PARTIAL` و`BLOCKED` على حد سواء.

---

## 9. سطح API والصلاحيات

| الطريقة | المسار | الإجراء | ملاحظة |
| --- | --- | --- | --- |
| `GET/POST` | `/api/tasks` | `tasks:view` / `tasks:manage` | قائمة / إنشاء (`{goal}`) |
| `GET` | `/api/tasks/:id` | `tasks:view` | المهمة + checkpoints + approvals + artifacts |
| `POST` | `/api/tasks/:id/approvals` | `tasks:manage` | طلب موافقة ⇒ `WAITING_APPROVAL` |
| `POST` | `/api/tasks/approvals/:id` | `users:manage` | قرار بشري (`approved`/`rejected`) — Manager+ فقط |
| `POST` | `/api/tasks/:id/resume` | `tasks:manage` | استئناف بمنح (تحقق R2) ⇒ `READY` أو DENY |

- `tasks:view` لكل الأدوار (كالقراءات) · `tasks:manage` للـManager+ والمنسّق (ككتابة التقارير الإدارية) · القرار `users:manage` حصرًا.
- بلا جلسة ⇒ `401` · بلا صلاحية ⇒ `403` · انتقال غير شرعي ⇒ `409` · عدم تطابق الاستئناف ⇒ `403 DENY`.

---

## 10. معايير القبول

```text
[ ] 1  قتل العملية أثناء EXECUTING → إعادة تشغيل → استئناف من checkpoint → نفس نتيجة التشغيل المتواصل
[ ] 2  خطوة تحتاج NEXA_A_PAID بلا منح → WAITING_APPROVAL → موافقة → استئناف → COMPLETED
[ ] 3  نفس السيناريو + رفض → BLOCKED أو REPLANNING (أبدًا استمرار صامت)
[ ] 4  عقد النتيجة يتحقق جزئيًا وما فيش بدائل ⇒ PARTIAL، أبدًا COMPLETED
[ ] 5  PLANNING→COMPLETED مستحيل · WAITING_APPROVAL من PLANNING/READY فقط · PARTIAL من VERIFYING فقط · BLOCKED بلا retry
[ ] 6  عبث بأي checkpoint ⇒ verifyChain=false والاستئناف مرفوض
[ ] 7  منح مُستهلك لا يُعاد استعماله · مقترح غير مطابق ⇒ DENY فوري · قرار غير بشري ⇒ رفض
[ ] 8  artifact من خطوة غير verified ⇒ رفض · artifacts مقروءة في PARTIAL وBLOCKED
[ ] 9  كل انتقال/قرار موثّق في audit · القرار يحمل users:manage
[ ] 10 typecheck نظيف · tests خضراء (القديمة كما هي + الجديدة) · build PASS · smoke خضراء · GEN3_GATE كلها true
```

---

## 11. GEN3_GATE (تقرير قبول)

```text
GEN3_GATE  runtime=PASS persistence_verified=true resume_verified=true
           approval_flow_verified=true partial_verified=true
           artifacts_verified=true tests_pass=ci
```

يُولَّد من `runGen3SelfChecks()` في `lib/tasks/gate.ts` ضد محوّل حقيقي (file في الاختبارات) — `tests_pass=ci` تعني: شاهد الاختبارات هو CI نفسه.

---

## 12. البوابات

| البوابة | الأمر | المتوقع |
| --- | --- | --- |
| الأنواع | `npm run typecheck` | نظيف |
| الاختبارات | `npm test` | القديمة (237) + الجديدة كلها خضراء |
| البناء | `npm run build` | PASS |
| Smoke | `npm start` ثم `npm run smoke` | خضراء (تشمل فحوص T1–T3 للمهام) |
| الوثائق | `npm run readme:check` + `readme:drift` | متزامن |

## 13. الخطوط الحمراء (لا تُساوَم)

- §5 باقية حرفًا: المهام والمقترحات لا تحمل انتماءً سياسيًا ولا «درجة إقناع» — تُرفض في الـvalidation لا في الـprompt.
- لا كتابة/قرار بلا إنسان: `decideApproval` بشرية حصرًا، والمنح أحادي الاستهلاك.
- لا استمرار صامت أبدًا: كل مسار مغلق ينتهي لـ`BLOCKED`/`REPLANNING` مصرّح به.
- الـ237 اختبارًا القديمة **لا تُلمس دلالاتها** — أي كسر = رفض الدورة.
- الأنوية **8** والكتالوج **27 أداة** — GEN-3 لا يغيّر سطرًا فيهما.

---

## 14. In English (short)

- **Goal:** promote a task from in-memory/JSONL (GEN-2) to a durable entity surviving restarts, with a real halt (`WAITING_APPROVAL`) instead of failing the whole run.
- **Persistence:** tasks/checkpoints/approvals/grants/artifacts live inside the existing `Store` (memory/file/postgres via the same `Repository Interface` + write-through) — no separate SQLite, no native deps; real durability on Postgres.
- **Engine:** standalone `lib/tasks/` consuming only `Repos` — no kernel/cell imports; sync API like `Repos`; checkpoints extend GEN-2 hash-chaining + evidence head; resume = verify chain → replay contexts → recorded state.
- **Approvals:** pending human grants with TTL; human-only single-approver decisions (`users:manage`); single-use grants; approve→`READY` after re-verifying `proposalHash+operation+costCap`, reject/expire→fail-closed `REPLANNING`/`BLOCKED`.
- **Acceptance:** the 4 critical tests (kill-resume equivalence, approve→COMPLETED, reject→BLOCKED/REPLANNING, partial⇒PARTIAL) + structural-impossibility rules + tamper-evident chain + `GEN3_GATE` all-true.
