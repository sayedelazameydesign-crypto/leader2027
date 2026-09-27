# عقد V5.3 — المنسّق HTTP فوق `lib/workers` (LOCKED)

> **الحالة:** LOCKED — يُنفَّذ كما هو. أي تغيير ⇒ نسخة عقد جديدة.
> **السلف:** `docs/contract-gen3.md` (المحرك) + `docs/contract-gen4.md` (العمّال) — كلاهما **مجمّد** في هذه الدورة.
> **الهدف:** تعريض تنسيق GEN-4 عبر HTTP: أي عميل مخوَّل (واجهة لاحقة/عامل خارجي) يطالب وينبض ويحرّر وينفّذ خطوات **مجانية** ويقرأ الحالة — والمدفوع مرفوض fail-closed حتى P2.

---

## 0. القرار (Scope)

- طبقة نقل HTTP رفيعة فوق `ExecutionCoordinator` — **لا منطق تنسيق جديد**: كل قرار ملكية/منح/سلسلة يبقى داخل `lib/workers` + `lib/tasks`.
- 6 مسارات فقط (لا SSE — polling موثّق).
- **التجميد:** صفر تعديل في `lib/tasks/` و`lib/workers/` و`lib/authorization/` — يُتحقق بـ`git diff --stat`.

---

## 1. القرارات المثبتة (D1–D4)

1. **D1 — الرفض قيمة عبر HTTP أيضًا:** نتائج المنسّق الكلّية تُنقَل كما هي في غلاف `200` (`claimed/ok/denied/...`) — امتداد D3. رموز HTTP للطبقة فقط: `400` تحقق مدخلات، `401/403` مصادقة/صلاحية، `500` غير متوقع (fail-closed بلا تسريب). لا `409` للتنافس — الـ`denied` روتين تشغيلي لا خطأ نقل.
2. **D2 — هوية العامل من الجلسة:** `workerId = "u:{userId}:{instance ?? 0}"` يُشتَق خادميًا — العميل يقدم `instance` اختياريًا فقط (`^[a-z0-9-]{1,32}$`)، والانتحال عبر المستخدمين مستحيل (مقيّد بالجلسة).
3. **D3 — المدفوع مرفوض حتى P2:** أي خطوة `needsGrant` (نفس تعريف المنسّق: `requiresApproval || operation === PAID`) تُرفَض خادميًا بـ`orchestrate.paid_not_wired` **قبل** لمس المنسّق — لا `call` يُحقَن عبر HTTP أبدًا، ولا نتائج مدفوعة بشهادة العميل (تكسر نموذج الدليل).
4. **D4 — صفر تغيير في السياسة:** الكتابة تتطلب `tasks:manage` والقراءة `tasks:view` (نفس GEN-3) — لا فعل جديد ولا تعديل مصفوفة (تُؤجَّل الدقة مع RBAC).

---

## 2. المسارات الستة

| المسار | الصلاحية | الجسم | النجاح `200` | الرفض `200` (أمثلة) |
|---|---|---|---|---|
| `POST /api/orchestrate/claims` | `tasks:manage` | `{taskId, instance?}` | `{status:"claimed", lease, reclaimed}` | `task.missing` · `lease.held` |
| `POST /api/orchestrate/heartbeats` | `tasks:manage` | `{leaseId, instance?}` | `{status:"ok", lease}` | `lease.expired` · `lease.not_owner` · `lease.superseded` |
| `POST /api/orchestrate/releases` | `tasks:manage` | `{taskId, instance?}` | `{status:"released", lease}` | `lease.not_owner` · `lease.released` |
| `POST /api/orchestrate/steps` | `tasks:manage` | `{taskId, stepId, instance?, verdict, observation?, evidence?, artifact?}` | `{status:"ok", task, attempt}` · `already-verified` · `skipped-duplicate` | `orchestrate.paid_not_wired` · `lease.*` · `grant.invalid` |
| `POST /api/orchestrate/batches` | `tasks:manage` | `{taskId, instance?, items:[{stepId, verdict, observation?, evidence?, artifact?}]}` (1–25 بندًا) | `{completed, applied, outcomes, task}` (توقف عند أول رفض — D6) | بند مدفوع ⇒ `orchestrate.paid_not_wired` عند موضعه وتوقف |
| `GET /api/orchestrate/tasks/:id/status` | `tasks:view` | — | `{task, lease, progress}` | `404` مهمة مجهولة |

- `verdict ∈ {"verified","failed"}` — صريح دائمًا (لا نجاح صامت).
- `observation` كائن، `evidence` أي قيمة JSON، `artifact` `{type, ref}` — تُمرَّر للمنسّق كما هي.
- الدفعة: تُنفَّذ البادئة المجانية عبر `executeBatch` ثم يتوقف عند أول بند مدفوع/مرفوض (بادئة دائمة قابلة للاستئناف).
- الحالة: `task{id,status,plan:[{id,operation,status}],checkpointHead,evidenceChainHead,updatedAt}` + `lease|null{workerId,fencingToken,acquiredAt,expiresAt,releasedAt,reclaimable}` + `progress{total,verified}`.

---

## 3. طبقة الخدمة (رفيعة)

- `lib/orchestrate/service.ts`: دوال تأخذ `(repos, user, input, now?)` وتعيد النتائج — المسارات تستدعيها بمقبض `getRepos()` طازج وساعة حقيقية لكل طلب (انضباط المقبض الطازج من GEN-4 §9).
- `lib/orchestrate/gate.ts`: `runV53SelfChecks(makeRepos)` + `formatV53Gate` (نفس نمط GEN3/GEN4_GATE).
- لا حالة بين الطلبات — الملكية في صفوف الـStore فقط.

---

## 4. الأخطاء (النقل فقط)

- `400`: JSON فاسد · حقل ناقص/نوع خاطئ · `instance` مخالف · `verdict` خارج القائمة · دفعة فارغة أو > 25 · `WorkerError` (خطأ عميل — يُترجَم 400 لا 500).
- `401`: بلا جلسة (نمط `requireUserForApi`).
- `403`: بلا `tasks:manage/view` حسب المسار.
- `404`: مهمة مجهولة في `status` فقط (بقية المسارات: `denied task.missing` داخل 200).
- `500`: ما عدا ذلك — رسالة عامة بلا تسريب داخلي.

---

## 5. معايير القبول

```text
[x] عقد V5.3 مكتوب ومقفَل قبل أي كود
[x] المسارات الستة تعمل: مصافحة + تنافس حصري عبر HTTP + نبض + تحرير
[x] خطوة مجانية كاملة عبر HTTP ⇒ ok + سلسلة سليمة
[x] خطوة مدفوعة ⇒ orchestrate.paid_not_wired (بلا أي أثر تنفيذي)
[x] دفعة [مجاني، مدفوع، مجاني] ⇒ الأول ينفَّذ والثاني يوقف (applied=1، completed=false)
[x] موت (انتهاء إيجار) + استرداد ⇒ استئناف نظيف (مغطى GEN-4 + بوابة V53 بساعة متحكَّم بها)
[x] status تعكس الملكية والتقدم بدقة (بما فيها reclaimable)
[x] 401 بلا جلسة · 403 لدور بلا صلاحية · 400 لمدخلات فاسدة
[x] V53_GATE كلها true
[x] typecheck نظيف · tests 346/346 · build PASS · smoke 58/58 حيًّا · drift نظيف
```

---

## 6. حدود الطبقة (مصرّح بها)

1. **لا SSE** — العميل يستطلع `status` (يُوثَّق التواتد المقترح في الواجهة لاحقًا، P3).
2. **لا تنفيذ مدفوع** — يُفتَح في P2 بربط خادمي حقيقي (D3).
3. **لا جدولة** — أول مطالب يكسب (موروث GEN-4 §9/3).
4. **نطاق العامل = المستخدم** — عمّال مستخدم لا يرون عمّال غيره إلا عبر رفض `lease.held` (لا تعداد للعمّال).
5. **التزامن الحرفي** — موروث GEN-4 §9/1 حرفيًا (LWW + كشف بأثر رجعي).

---

## 7. V53_GATE (تقرير قبول)

```text
V53_GATE  runtime=PASS http_exclusivity_verified=true free_execute_verified=true
          paid_denied_verified=true batch_stop_verified=true status_verified=true
          tests_pass=ci
```

يُولَّد من `runV53SelfChecks()` في `lib/orchestrate/gate.ts` — `tests_pass=ci` شاهدها CI نفسه.

---

## 8. البوابات

| البوابة | الأمر | المتوقع |
|---|---|---|
| الأنواع | `npm run typecheck` | نظيف |
| الاختبارات | `npm test` | 335 + الجديدة كلها خضراء |
| البناء | `npm run build` | PASS (المسارات الستة ظاهرة) |
| Smoke | `npm start` ثم `npm run smoke` | خضراء (52 + T4 الجديدة) |
| الوثائق | `npm run readme:check` + `readme:drift` | متزامن |

## 9. الخطوط الحمراء (لا تُساوَم)

- صفر تعديل في `lib/tasks/` و`lib/workers/` و`lib/authorization/` و`lib/cells/` — يُتحقق بـ`git diff --stat`.
- الـdenials التشغيلية **لا تتحول 500 أبدًا** — أي 500 من مسار منسّق = كسر عقد.
- لا `call` يُبنى من مدخلات HTTP — أي تسريب = رفض الدورة.
- الـ335 اختبارًا **لا تُلمس دلالاتها** — أي كسر = رفض الدورة.
- الأنوية **8** والكتالوج **27 أداة** كما هي — V5.3 مسارات فوق الموجود فقط.

---

## 10. In English (short)

- **Goal:** thin HTTP transport over GEN-4's `ExecutionCoordinator`: claim/heartbeat/release/execute-free-steps/batch/status for authorized clients (future UI/external workers).
- **Decisions:** denials stay values over HTTP (200 envelopes; HTTP codes are transport-only); worker identity is server-derived from the session (`u:{userId}:{instance}`); paid steps are fail-closed denied (`orchestrate.paid_not_wired`) until P2 server-side tool wiring — never client-attested; zero policy changes (`tasks:manage` writes, `tasks:view` reads).
- **Shape:** 6 routes; per-request fresh `getRepos()` + real clock; no inter-request state; ownership lives only in Store lease rows.
- **Acceptance:** exclusivity over HTTP, free-step execution, paid denial with zero side effects, batch prefix-stop, reclaim-resume, accurate status, auth/matrix/validation boundaries, all-true `V53_GATE`, frozen GEN-3/GEN-4 (zero edits).
