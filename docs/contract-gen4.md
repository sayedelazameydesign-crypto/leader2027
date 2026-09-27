# عقد GEN-4 — التنفيذ الموزّع (Multi-Worker)

> **الحالة: LOCKED قبل التنفيذ** — أي تنفيذ خارج هذا العقد يُردّ. المنبع: مواصفة GEN-4 (تنفيذ موزّع متعدد العمال).
> **المبدأ الحاكم:** فصل *الحالة التجارية* (GEN-3 — لا تُمسّ) عن *ملكية التنفيذ* (طبقة جديدة فوقها). الـworker لا سلطة له على الحالة — فقط على مَن يملك حق تنفيذ الخطوة الآن.

---

## 1. الهدف في سطر

أكثر من worker يسحب مهامًا من نفس `Store`، دون خرق ثوابت GEN-3 (آلة الحالة البنيوية + منح NEXA الـfail-closed).

---

## 2. النطاق

### داخل النطاق

| البند | الوصف |
| --- | --- |
| **Leases** | ملكية تنفيذ لكل `taskId`: `{taskId, workerId, acquiredAt, expiresAt, fencingToken}` — المصدر الوحيد صف في `Store` |
| **Heartbeats** | تجديد الملكية + سجل `{leaseId, workerId, at}` — هامش أمان ثابت قبل `expiresAt` |
| **Fencing tokens** | رقم تصاعدي لكل lease على نفس المهمة — يمنع كتابة worker متأخر فوق الأحدث |
| **R7–R10** | امتداد بنيوي: لا تنفيذ بلا lease · هامش التجديد · استرداد بتحقق replay · إعادة تحقق NEXA عند التنفيذ الفعلي |
| **Exactly-once للمدفوع** | `attemptToken = hash(proposalHash + fencingToken)` + سجل منفَّذ — تخطي idempotent بدل إعادة النداء |
| **Batching تنفيذي** | تجميع كتابات بترتيب منطقي واحد لكل `taskId` — فشل قبل الإكمال ⇒ البادئة الدائمة تُستأنف كما هي |
| **GEN4_GATE** | تقرير قبول ذاتي من المنسّق نفسه |

### خارج النطاق (صراحة)

- ❌ RBAC/تعدد الموافقين، UI الموافقات (ما زالا مؤجّلين)
- ❌ Cross-region replication أو جدولة عادلة/work-stealing متقدمة
- ❌ أي تغيير في آلة الحالة التجارية (GEN-3) — القفل طبقة فوقها فقط، وصفر تعديل في `lib/tasks/`
- ❌ مسارات HTTP جديدة — التنسيق عند مستوى `Store` (العمال يتشاركون القاعدة لا الـHTTP)؛ يقوده منسّق لاحق (V5.3)

---

## 3. قرارات معمارية مُثبَّتة

1. **D1 — المصدر الوحيد صف `Lease` في `Store`:** لا حالة ملكية في ذاكرة أي worker. القرار يُحسَم بقراءة الصفوف فقط — worker يسقط تاركًا الصف، وآخر يسترده بالقراءة نفسها.
2. **D2 — بلا advisory locks وبلا Redis:** جسر `spawnSync` في Postgres يفتح جلسة جديدة لكل استدعاء — فأقفال الجلسات (`pg_advisory_lock`) مستحيلة البقاء، ولا بنية Redis في المشروع. القفل = صفوف + `fencingToken` تصاعدي + كشف forks بالسلسلة. حدود الطبقة موثقة في §9.
3. **D3 — المنسّق كلّي النتائج (total):** كل طرق `ExecutionCoordinator` تُرجع `{status: ok|denied|…}` ولا ترمي للمسائل التشغيلية (R7: غياب lease ⇒ **deny مش استثناء**). الرمي للأخطاء البرمجية فقط (مدخلات فاسدة الأنواع).
4. **D4 — الهامش نافذة استرداد مبكر:** `renewalDeadline = expiresAt − margin`. بعد الموعد يُسترد الـlease (مالكه الأصلي ما زال يعمل نظريًا حتى `expiresAt`) — والتعارض يُحسَم بالـfencing: الأحدث tokenًا يكسب، وكتابات الأقدم مرفوضة.
5. **D5 — الـidempotency مفتاحها مستقر:** البحث في سجل المنفَّذ بـ`(taskId, stepId, proposalHash)` — والـ`attemptToken` (مع الـfencing) يوثّق *أي حقبة* نفّذت. هكذا لا نداء مكرر عبر الاسترداد ولا عبر التعارض.
6. **D6 — الـbatching فوق السلسلة نفسها:** لا مخزن مؤقت منفصل ولا ترتيب تجزئة جديد — تطبيق مرتّب على نفس المحرك، والتوقف عند أول فشل. البادئة الدائمة + `verifyChain` هما الضمان.
7. **D7 — صفر تعديل في `lib/tasks/` و`lib/authorization/`:** لا إجراءات مصفوفة جديدة (بلا HTTP)، ولا انتقالات جديدة — R7–R10 طبقة ملكية لا حالات تجارية.

---

## 4. نموذج البيانات (إضافة على GEN-3)

```json
{
  "Lease": {"taskId":"", "workerId":"", "acquiredAt":"", "expiresAt":"", "fencingToken":0},
  "Heartbeat": {"leaseId":"", "workerId":"", "at":""}
}
```

| الامتداد | الحقل | السبب |
| --- | --- | --- |
| `Lease.id` | معرّف الصف | مرجع Heartbeat والتدقيق |
| `Lease.lastHeartbeatAt` | آخر تجديد | كشف التوقف بدقة |
| `Lease.releasedAt` | طابع التسليم الطوعي | تمييز التسليم النظيف عن الانتهاء |
| `TaskAttempt` | `{taskId, stepId, proposalHash, attemptToken, fencingToken, status, evidenceHash, recordedAt}` | سجل المنفَّذ للـexactly-once (§6) |

تعيش الثلاثة داخل `Store` (نفس نمط GEN-3: `memory/file/postgres` تلقائيًا + write-through + توافق قدماء بالانتشار).

---

## 5. القواعد البنيوية R7–R10

- **R7:** لا تنفيذ خطوة إلا بـlease نشط (الأحدث + مالكه المنفِّذ + `now < expiresAt`) — غيابه ⇒ **denied** (نتيجة لا استثناء).
- **R8:** التجديد قبل `expiresAt − margin` (افتراضي: TTL ‏30s والهامش ‏5s). فوات الموعد ⇒ الـlease قابل للاسترداد من أي worker آخر — والمالك القديم يُfence عند أول contact تالٍ.
- **R9:** الاسترداد (وكل `claim`) يتحقق من سلسلة التجزئة (`verifyChain` — نفس منطق GEN2_REPLAY) قبل أي تنفيذ — سلسلة مكسورة ⇒ deny (لا استئناف أعمى).
- **R10:** أفعال `NEXA_A_PAID` يعاد التحقق من (grant مُستهلَك مطابق + `cap ≥ cost`) عند **بداية التنفيذ الفعلي** لا وقت الـclaim — لا اعتماد على قرار قديم. المنسّق لا يخزّن أي قرار.

قواعد ملكية مكمّلة (منطوق المواصفة):
- محاولة `acquire` فاشلة ⇒ الـworker يتجاهل المهمة تمامًا (لا تنفيذ متفائل) — مع توثيق `lease.denied` في التدقيق.
- مهمة في حالة نهائية (`COMPLETED/PARTIAL/BLOCKED`) ⇒ الـclaim مرفوض (`task.terminal`) — لا ملكية بلا عمل.
- `release` طوعي من المالك فقط — غير المالك ⇒ denied صامت.

---

## 6. Exactly-once لأفعال NEXA المدفوعة

```
تنفيذ مدفوع ──▶ lease؟ ──▶ grant+cap الآن؟ ──▶ سجل (taskId,stepId,proposalHash) منفَّذ؟
     │ denied        │ denied             │ نعم ⇒ تخطي idempotent (بلا نداء)
     │               │                    │ لا ⇒ attemptToken=hash(proposalHash+fencingToken)
     │               │                    │     ⇒ النداء ⇒ تسجيل executed ⇒ observe/verify
```

- خطوة `verified` أصلًا ⇒ تخطي قبل أي فحص (`already-verified`) — الاسترداد بعد الإكمال لا يعيد النداء أبدًا.
- خطوة `running/observed` (موت mid-step) ⇒ يُستأنف من النقطة الدائمة: النداء يُعاد فقط إن لم يُسجَّل منفَّذًا، وإلا أُعيد استعمال الدليل المسجَّل.
- النافذة المتبقية (نداء ناجح + موت قبل التسجيل) غير قابلة للإغلاق بلا معاملة ثنائية — موثقة كحد طبقة (§9)، والاختبارات تقتل عند حدود دائمة.

---

## 7. Checkpoint batching

- `executeBatch(taskId, workerId, items[])`: تطبيق مرتّب لخطوات عبر نفس المحرك — كل خطوة checkpoints مسلسلة كالمعتاد، والتوقف عند أول (فشل/رفض) بلا تخطٍّ.
- تعطّل قبل الإكمال ⇒ البادئة الدائمة هي الحقيقة: `verifyChain=true` + الاستئناف يُكمل من بعدها — **لا فقد** (البادئة محفوظة) **ولا ازدواج** (اللاحق لا يعيد السابق).
- لا ترتيب تجزئة جديد ولا مخزن مرحلي — الـbatching تنفيذي خالص (D6).

---

## 8. معايير القبول (الحاسمة 5 + صلابة)

```text
[x] 1  workerان يطالبان بنفس المهمة لحظيًا ⇒ واحد ينفّذ والآخر denied بهدوء (لا ازدواج)
[x] 2  موت mid-EXECUTING (توقف heartbeat) ⇒ انتهاء ⇒ استرداد ⇒ استئناف متحقَّق ⇒ نفس النتيجة بلا نداء مدفوع مكرر (ذاكرة + ملف منفصلًا)
[x] 3  خطوة طويلة + heartbeat مستمر ⇒ لا استرداد مبكر رغم الطول
[x] 4  ظروف NEXA تغيّرت بين الـclaim والتنفيذ ⇒ إعادة التحقق تمنع/تسمح صحيحًا (لا قرار قديم)
[x] 5  تعطّل قبل إكمال الـbatch ⇒ الاستئناف يعيد نفس الحالة بالضبط (لا فقد ولا ازدواج)
[x] 6  stale worker (lease منتهٍ/مستبدَل) ⇒ heartbeat وتنفيذ مرفوضان (fencing) — وكتاباته لا تلوّث السلسلة
[x] 7  مهمة نهائية ⇒ claim مرفوض · مهمة مكسورة السلسلة ⇒ claim مرفوض (fail-closed)
[x] 8  typecheck نظيف · tests خضراء (335/335) · build PASS · smoke خضراء 52/52 · GEN4_GATE كلها true
```

---

## 9. حدود الطبقة (مصرّح بها لا مخفية)

1. **نموذج التزامن (مصرّح بدقة — مراجعة الإغلاق):**
   - **داخل العملية الواحدة:** كل عمليات المنسّق متزامنة (`sync`) ⇒ لا تداخل ⇒ الـclaim والفحص-ثم-الفعل (check-then-act) ذرّيان.
   - **عبر المقابض، متسلسلة (النموذج المُختبَر والمدعوم):** أي عملية تقرأ بمقبض طازج — انضباط `getRepos()` في الإنتاج: مقبض جديد لكل طلب — ترى أحدث صفوف الإيجار/المحاولات ⇒ الكشف **وقت الـclaim** (المتأخر `denied` فورًا)، وسجل المحاولات يمنع النداء المكرر. المقابض المنفصلة في `workers-distributed` حقيقية (إعادة فتح فعلية للملف) لا ذاكرة مشتركة.
   - **عبر العمليات، متزامنة حرفيًا (القيد الموروث):** `file` و`postgres` متطابقا الدلالات حرفيًا — مستند كامل + LWW عند الكتابة المتزامنة (موثّق في `postgres.ts` نفسه) ⇒ كتابتان متداخلتان = فوز الأخير + كشف fork **بأثر رجعي** عند أول قراءة طازجة (صف إيجار مختفٍ أو `fencingToken` متجاوَز + `verifyChain` يفشل بصوت لا بصمت). في هذه النافذة الضيقة سجل المحاولات نفسه check-then-act غير ذرّي على **كلا** الباك-إندين — أي أن الضمان القوي للتسلسل، والتوازي الحرفي قيد موروث من طبقة الـStore (VS5) لا من GEN-4، ولا يُزعم اختباره (يتطلب harness توازٍ حقيقيًا).
   - **انضباط المقبض الطازج (شرط استخدام):** المنسّق كمكتبة يتطلب مقبض `Repos` طازجًا لكل عملية — مقبض ملف طويل العمر يرى لقطة قديمة. مقترح V5.3: منسّق يقبل مصنع مقابض `() => Repos` بدل مقبض واحد (صحيح بالبناء).
2. **نافذة النداء-التسجيل:** (§6) — موت بين نجاح النداء وتسجيله قد يعيد النداء عند الاسترداد. الإغلاق الكامل يتطلب معاملة خارجية (مستقبل).
3. **لا عدالة جدولة:** أول مطالب يكسب — بلا أولويات ولا work-stealing (خارج النطاق صراحة).

---

## 10. GEN4_GATE (تقرير قبول)

```text
GEN4_GATE  runtime=PASS lease_exclusivity_verified=true fencing_verified=true
           reclaim_replay_verified=true exactly_once_verified=true
           batch_crash_recovery_verified=true tests_pass=ci
```

يُولَّد من `runGen4SelfChecks()` في `lib/workers/gate.ts` — `tests_pass=ci` شاهدها CI نفسه.

---

## 11. البوابات

| البوابة | الأمر | المتوقع |
| --- | --- | --- |
| الأنواع | `npm run typecheck` | نظيف |
| الاختبارات | `npm test` | 335/335 خضراء (298 أصلية + 37 GEN-4، 12 تخص pg-live) |
| البناء | `npm run build` | PASS |
| Smoke | `npm start` ثم `npm run smoke` | خضراء 52/52 (بلا مسارات جديدة) |
| الوثائق | `npm run readme:check` + `readme:drift` | متزامن |

## 12. الخطوط الحمراء (لا تُساوَم)

- §5 باقية حرفًا (يرثها المنسّق من المحرك — لا مسار جانبي يتجاوزها).
- صفر تعديل في `lib/tasks/` وآلة GEN-3 و`lib/authorization/` — يُتحقق بـ`git diff --stat`.
- لا تنفيذ متفائل ولا استئناف أعمى ولا قرار NEXA قديم — كلها deny صريح.
- الـ298 اختبارًا القديمة **لا تُلمس دلالاتها** — أي كسر = رفض الدورة.
- الأنوية **8** والكتالوج **27 أداة** ومسارات الـAPI كما هي — GEN-4 طبقة مكتبية خالصة.

---

## 13. In English (short)

- **Goal:** multiple workers pull tasks from the same `Store` without breaking GEN-3 invariants (structural state machine + fail-closed NEXA grants).
- **Principle:** separate business status (GEN-3, untouched) from execution ownership (new layer above). A worker has no authority over status — only over who may execute a step right now.
- **Leases:** rows in `Store` (`taskId/workerId/acquiredAt/expiresAt/fencingToken` + heartbeats); monotonic fencing per task; renewal deadline `expiresAt − margin`; reclaim verifies the hash chain first (GEN2_REPLAY logic).
- **Decisions:** lease rows are the sole truth (no advisory locks — incompatible with the `spawnSync` bridge — no Redis); the coordinator is total (denials are values, R7); NEXA grants re-verified at execution start (R10); idempotency keyed stably with the fencing token recorded as proof of epoch.
- **Acceptance:** the 5 critical tests (exclusive claim, death→reclaim→same result with no duplicate paid call, long step + heartbeat, changed NEXA conditions, batch-crash recovery) + fencing/terminal/integrity denials + all-true `GEN4_GATE`.
