# مخطط CeliaOS النهائي 2026 (Blueprint)

> **الحالة:** مسودة معتمدة للمراجعة — ليست عقد LOCKED بعد.
> **النطاق:** منصة Agent OS كاملة (واجهة → منسّق → محرك مهام → عمّال → أدوات → تحقق).
> **المنهج:** تحقَّق من الشواهد لا الادعاءات (artifacts, not claims).

**مفتاح التحقق في هذه الوثيقة:**

| الرمز | المعنى |
|---|---|
| ✅ | متحقق منه داخل مساحة العمل هذه (`leader2027` فرع `arena/01a0e1ab`) ببوابات خضراء |
| 📋 | مُبلَّغ في سياق جلسات/مستودعات أخرى — **لم يتحقق منه هنا** |
| ❌ | غائب — لا أثر له في مساحة العمل |

---

## 1. المعمارية المستهدفة

```text
┌────────────────────────────────────────────────────────┐
│  Agentic Workspace (واجهة)            ❌ غائبة          │
│  Mission · Plan · Trace · Approvals · Artifacts        │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼────────────────────────────┐
│  V5.3 HTTP Orchestrator               ❌ التالي (P0)    │
│  claim · heartbeat · release · execute · status-stream │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  GEN-3 Task Engine                    ✅ مكتمل          │
│  READY→EXECUTING→OBSERVING · موافقات · أدلة · سلسلة   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  GEN-4 Workers                        ✅ مكتمل          │
│  leases · fencing · exactly-once · batching            │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  Kernel + NEXA Policy                 ✅ موجود          │
│  8 خلايا · 27 أداة · deny-by-default · منح بشرية      │
│  + MCP surface: /api/mcp              ✅ موجود          │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  Store (memory / file / postgres)     ✅ موجود          │
│  مستند كامل + LWW + write-through (VS5 دلالات)        │
└────────────────────────────────────────────────────────┘
```

**ملاحظة معمارية:** القوة في `Kernel → Policy → Task Engine → Workers → Tools → Evidence → Verification`. الواجهة طبقة عرض فقط — لا سلطة لها على الحالة (تُدار عبر الـOrchestrator).

---

## 2. الموجود فعلًا ✅ (متحقق هنا)

| الطبقة | الشاهد | البوابات |
|---|---|---|
| الأنوية الذرية (8) | `lib/cells/*` + `lib/kernel/bridge.ts` (الخط الوحيد للعبور) | typecheck نظيف |
| كتالوج الأدوات (27) | الخلايا + سطح MCP (`lib/mcp/server.ts` + `/api/mcp`) | smoke يغطي المسارات |
| سياسة NEXA (§1–§3) | `lib/authorization/policy.ts` — مجهول⇒DENY، سقف افتراضي $0، منح المدفوع للبشري فقط | ضمن 335 اختبارًا |
| GEN-3 محرك المهام | `lib/tasks/` + `docs/contract-gen3.md` + 5 مسارات `/api/tasks/**` | GEN3_GATE خضراء |
| GEN-4 التنفيذ الموزع | `lib/workers/` + `docs/contract-gen4.md` (مكتبة، بلا HTTP) | GEN4_GATE خضراء |
| التخزين الدائم | `Store` + memory/file/postgres + عقد تخزين يعمل على ملف حقيقي كل تشغيل | العقد أخضر (pg-live مشروط بالبيئة) |
| الانضباط | manifest + README مولّدة + فحص انحراف | `readme:check` + `drift` متزامنان |

**الإجمالي:** `335/335` اختبارًا (12 تخص pg-live) · `52/52` smoke حي · build PASS — على هذا الفرع فقط (ليست على `main` بعد).

---

## 3. المُبلَّغ غير المتحقق 📋 (خارج مساحة العمل)

| البند | المصدر المُبلَّغ | الملاحظة |
|---|---|---|
| `new-new`: واجهة دردشة + مخطط DB | سياق الجلسات | المستودع **موجود** (آخر تحديث 17 أغسطس 2026 — راكد ~6 أسابيع)، الشكل العام (client/server/shared + drizzle + Dockerfile) متسق مع الوصف. **لم يُدقَّق محتواه هنا.** |
| `gethip_agen`: ApprovalStore + SQLite + نقاط `/api/approvals` | سياق الجلسات | ⚠️ **غير قابل للحل عبر API** (`Could not resolve to a Repository`) — محذوف أو مُعاد تسميته أو خاص. كل الادعاءات المرتبطة به (17 اختبارًا، commits `87e817c`/`45aeb7f`) **غير قابلة للتحقق حاليًا**. |
| v1.0.0 "GO" + شواهد `certification/` + فروع `arena/01a0a9e0-12pro` | سياق الجلسات | لا أثر لها في مساحة العمل. تُعامل كتاريخ مشروع لا كحالة راهنة مؤكدة. |
| 173/173 اختبارًا (B0–B2.5) · 82 capability · موفّرون (Gemini/mock/OpenRouter) · 4 connectors | سياق الجلسات | لا أثر في `leader2027` (لا مزوّد LLM إطلاقًا في الشجرة — فحص مباشر). إن وُجدت ففي شجرة أخرى غير حاضرة. |
| M10.x الموزّع (Redis/Redlock) · Handbook 53% · MessageBusV4 | سياق الجلسات | تاريخ تطوري؛ GEN-4 الحالي **استبدل** مسار Redis بقرار D2 الموثق (صفوف Lease بدل الأقفال). |
| `celia.pro` موقع حي + هدف النشر غير محسوم | سياق الجلسات | قرار نشر معلّق — يُحسم في P4. |

**القاعدة:** أي بند 📋 لا يُبنى عليه قرار معماري حتى يُستحضر شاهده (رابط commit/فرع قابل للفتح) أو يُعاد بناؤه هنا.

---

## 4. الناقص ❌ (الفجوات الحقيقية)

1. **V5.3 المنسّق HTTP** — لا يوجد أي مسار فوق `lib/workers`. الـGEN-4 مكتبة داخلية فقط. **هذا هو P0.**
2. **Agentic Workspace** — واجهة `leader2027` الحالية إدارة حملات (login/dashboard) لا مساحة مهمات (لا Mission/Plan/Trace/Artifacts/Approvals panels).
3. **ربط الأدوات الفعلية بالعمّال** — المنسّق يقبل `call` محقونًا (والبوابة المدفوعة NEXA تعمل)، لكن لا connectors حقيقية مربوطة (browser/coder/data) ولا مزوّد LLM/BYOK في الشجرة.
4. **قرار النشر + بوابة الإنتاج** — الهدف (حاوية Highway مع volume مقابل Vercel لاحقًا) غير محسوم؛ وبوابة "Production PASS" على المضيف الحقيقي غير منفذة.
5. **التوحيد** — 8+ فروع `arena/*` على `leader2027` و`main` متأخرة عن هذا الفرع بـ3 commits؛ ومستودعات مشتتة (`new-new` راكد، `gethip_agen` مفقود). لا يوجد "فرع/مستودع سجل" معلن.

---

## 5. ترتيب البناء (ابنِ أولًا ما يفتح الطريق)

### P0 — V5.3 المنسّق HTTP (التالي فورًا)
- **النطاق:** مسارات فوق `lib/workers` فقط: `claim · heartbeat · release · execute · batch-status` + بث حالة (SSE أو polling موثّق) + مصنع مقابض `() => Repos` طازجة لكل طلب (صحيح بالبناء على الملف).
- **الهوية:** هوية الـworker عبر الجلسات/الأدوار القائمة — لا رموز مشتركة جديدة بلا توثيق.
- **اللاهدف:** لا واجهة، لا connectors جديدة، لا تعديل في `lib/tasks` أو `lib/authorization` أو آلة GEN-3 (تجميد الأجيال).
- **البوابات:** عقد `docs/contract-v53.md` يُقفَل أولًا → typecheck/tests/build/smoke موسّعة → `V53_GATE`.

### P1 — التوحيد (قرار مالك، لا كود كثير)
- إعلان مستودع/فرع السجل (المرشّح الطبيعي: `leader2027` + دمج هذا الفرع في `main` عبر PR مراجَع).
- مصير `new-new` (أرشفة/إعادة توجيه) و`gethip_agen` (استعادة/إسقاط رسمي من السجل).
- بعد الدمج: `main` هي الحقيقة، والفروع `arena/*` تُغلق أولًا بأول.

### P2 — ربط الأدوات والمزوّدين
- connectors حقيقية خلف بوابة NEXA المدفوعة + مزوّد LLM واحد على الأقل (BYOK، لا مفاتيح في git).
- كل فعل مدفوع يمر `kernel.execute` + `attemptToken` (البنية جاهزة — ينقصها الأطراف).

### P3 — Agentic Workspace
- panels فوق مسارات V5.3: المهمة وهي تُنفَّذ (Plan/Steps/Tools/Evidence/Trace حي) + الموافقات البشرية.
- الواجهة تعرض فقط — أي كتابة حالة عبر الـOrchestrator.

### P4 — النشر والإنتاج
- حسم الهدف (التوصية المُبلَّغة: حاوية + volume دائم؛ Vercel تُؤجَّل لما بعد Postgres للإنتاج).
- بوابة "Production PASS" منفصلة على المضيف الحقيقي قبل أي وسم نهائي (تمييز RC عن Production).

---

## 6. هيكل V5.3 المقترح (للاعتماد قبل البناء)

```text
POST /api/orchestrate/claims     { taskId, workerId }        → claimed | denied
POST /api/orchestrate/heartbeats { leaseId, workerId }       → renewed | denied
POST /api/orchestrate/releases   { taskId, workerId }        → released | denied
POST /api/orchestrate/steps      { taskId, workerId, stepId, input } → ok | skipped-duplicate | denied
GET  /api/orchestrate/tasks/:id/status                        → status + lease + progress (+ SSE لاحقًا)
```

- كل طلب = `getRepos()` طازج + منسّق جديد + ساعة حقيقية (لا ساعة محقونة إلا في الاختبارات).
- المصادقة: جلسة قائمة + دور يسمح بالتنفيذ (يُحدَّد في العقد — لا `x-admin-token` مشترك جديد).
- الـdenials قيم JSON صريحة (امتداد فلسفة R7) لا استثناءات 500.

---

## 7. أسئلة مفتوحة للمالك

1. **V5.3:** اعتماد الهيكل أعلاه أم تعديل المسارات/الأسماء قبل كتابة العقد؟
2. **السجل:** هل `leader2027/main` (بعد دمج هذا الفرع) هو مستودع الحقيقة؟ ومصير `new-new`؟
3. **`gethip_agen`:** استعادة (رابط/اسم جديد) أم إسقاط رسمي من السجل؟
4. **النشر:** حسم هدف P4 الآن أم بعد V5.3؟
5. **المزوّدون:** أي مزوّد LLM أول (P2) — Gemini المجاني أم غيره؟

---

## 8. In English (short)

- **Method:** verify artifacts, not claims. ✅ = verified in this workspace (`leader2027`, branch `arena/01a0e1ab`, green gates); 📋 = reported from other sessions/repos, unverified here; ❌ = absent.
- **Verified present:** 8 kernel cells + 27-tool catalog + MCP surface; NEXA policy §1–§3; GEN-3 task engine (5 routes); GEN-4 workers (library-only); persistent Store (memory/file/postgres); 335/335 tests + 52/52 live smoke.
- **Reported, unverified:** `new-new` (exists, stale since Aug 17); `gethip_agen` (**unresolvable via API** — all linked claims unverifiable); v1.0.0 "GO", 173/173 gates, 82 capabilities, providers/connectors, M10.x Redis runtime — no trace in this workspace.
- **Gaps:** V5.3 HTTP orchestrator (P0, next); Agentic Workspace UI; real tool/provider wiring behind NEXA; deploy-target decision + Production PASS gate; repo/branch consolidation (8+ arena branches, main behind).
- **Build order:** P0 orchestrator (contract-first, frozen GEN-3/GEN-4) → P1 consolidation → P2 tools/providers → P3 workspace → P4 deploy + Production PASS.
