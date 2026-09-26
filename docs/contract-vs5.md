# عقد VS5 — بوابة الوكلاء (MCP) · الشريحة V5.1 «الجسر الآمن للقراءة»

> **الحالة: LOCKED قبل التنفيذ** — أي تنفيذ خارج هذا العقد يُردد. المنبع الفكري: [`docs/idea-trusted-agent-computer.md`](idea-trusted-agent-computer.md).
> **الترتيب الإلزامي (معتمد من المالك):** T1 (Postgres) ← عقد VS5 ← V5.1. هذا العقد يغطي **T1 + V5.1 + تقوية سر الجلسة (T2)** في دورة واحدة.

---

## 1. النطاق

### داخل النطاق — هذه الدورة

| البند | الوصف |
| --- | --- |
| **T1 — محوّل PostgreSQL** | `createPostgresRepos` فوق نفس `Repository Interface` — **بلا تعديل على domain** — مع schema وبذر أولي واختبارات عقدية |
| **T2 — سر الجلسة** | رفض التشغيل الإنتاجي على السر الافتراضي (إلزام `L27_SESSION_SECRET` ما لم تُصرَّح استثناءً للاختبار) |
| **V5.1 — سطح MCP للقراءة** | نقطة نهاية JSON-RPC 2.0 (`POST /api/mcp`) تُعلن الكتالوج وتنفّذ **أدوات القراءة وحدها** |
| **تسجيل الجلسات** | كل `tools/call` يُسجَّل في التدقيق بمعرّف جلسة — «Replay» = إعادة بناء الجلسة من التدقيق وحده |

### خارج النطاق (صراحة)

- ❌ إنشاء طلبات موافقة عبر MCP (**V5.2**) ❌ أي تنفيذ كتابة عبر MCP (**V5.3+**)
- ❌ مصادقة رموز مستقلة للوكلاء (`L27_MCP_TOKEN`) — تُقرَّر في عقد لاحق؛ V5.1 يعتمد جلسة بشرية مصادقًا عليها
- ❌ واجهة Replay بشرية (**V5.5**) ❌ ذاكرة/RAG (**V5.4**) ❌ أي نواة جديدة أو تغيير في الأنوية الثمانية
- ❌ تغيير `Repository Interface` أو خدمات المجال (domain)

---

## 2. قرارات معمارية مُثبَّتة

1. **الواجهة المتزامنة باقية:** `Repos` متزامنة بالعقد — محوّل PostgreSQL يضمن الكتابة الفورية عبر جسر `spawnSync` (أبن يستعلم بـ`pg`)، بنفس دورة `getRepos()` الطازجة في وضع `file`. تفاصيل: `lib/persistence/postgres.ts`.
2. **دلالات المخزن مطابقة لـ`file`:** مستند Store كامل + write-through بعد كل mutation — نفس سلوك `createFileJsonRepos` حرفاً (LWW على مستوى المستند). الترقية لصفوف علائقية لاحقة فوق نفس الواجهة.
3. **البذر:** أول تشغيل على قاعدة فارغة ⇒ seed كامل (الحسابات الست + الحملة + البيانات التشغيلية) — نفس `seedIfEmpty` في وضع file.
4. **MCP = سطح لا نواة:** `lib/mcp/server.ts` يستهلك القدرات الموجودة (`getKernel` + `repos`) — الأنوية الثمانية لا تتغيّر، وعددها لا يتغيّر.
5. **الوكالة بالتفويض لا التصعيد:** أدوات القراءة عبر MCP تُنفَّذ **بسلطة الجلسة البشرية المصادق عليها**، والهوية الوكيلية (`x-l27-agent`) تُسجَّل في التدقيق. لا سلطة تُمنح ولا تُزاد.
6. **الكتابة مرفوضة قبل التنفيذ:** أداة الكتابة عبر MCP ⇒ **رفض قاطع** (لا يُستدعى kernel.execute إطلاقًا) + حدث تدقيق `mcp.write.denied`. لا حتى طلب موافقة (ذلك V5.2).
7. **JSON-RPC 2.0** على `POST /api/mcp` بأسلوب Streamable HTTP مصغَّر: `initialize` · `ping` · `tools/list` · `tools/call` · الإشعارات (بلا `id`) ⇒ 202 بلا استجابة. `GET` ⇒ 405.

---

## 3. معايير القبول (Acceptance Criteria)

```text
[ ] 1  POST /api/mcp ‏initialize ⇒ { protocolVersion, capabilities.tools, serverInfo } + ترويسة Mcp-Session-Id
[ ] 2  tools/list ⇒ كل الأدوات المُعلَنة (27) مع inputSchema ووسم «يتطلب موافقة بشرية» لأدوات الكتابة
[ ] 3  tools/call أداة قراءة ⇒ تُنفَّذ بسلطة الجلسة وتعيد structuredContent
[ ] 4  tools/call أداة كتابة ⇒ مرفوضة (isError) بلا تنفيذ وبلا طلب موافقة + تدقيق mcp.write.denied
[ ] 5  كل tools/call (نجاحًا أو رفضًا) يُسجَّل في التدقيق بمعرّف الجلسة — إعادة بناء زمنية للجلسة من التدقيق وحده (Replay)
[ ] 6  بلا جلسة ⇒ 401 · إشعار بلا id ⇒ 202 بلا محتوى · طريقة أخرى ⇒ JSON-RPC error مقيَّد
[ ] 7  T1: عقد persistence خضراء على المحوّل الجديد (create/read/update/volunteers+reports+audit) — حيّة ضد Postgres عند توفّر L27_TEST_DATABASE_URL
[ ] 8  T1: L27_STORE=postgres يشتغل عبر نفس getRepos() بلا تغيير في المسارات — والبذر يعمل على قاعدة فارغة
[ ] 9  T2: الإنتاج على السر الافتراضي يرفض التوقيع (إلا بـL27_ALLOW_INSECURE_SECRET=1) — الاختبارات والتطوير بلا تأثّر
[ ] 10 typecheck نظيف · tests خضراء (القديمة كما هي + الجديدة) · build PASS · smoke خضراء ضد next start
[ ] 11 CI أخضر — بما فيه اختبار المحوّل الحيّ ضد خدمة Postgres
```

---

## 4. سطح MCP — العقد التقني

| الطريقة | السلوم |
| --- | --- |
| `initialize` | `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "leader2027-agent-gateway", version }, instructions }` — يُعاد `protocolVersion` المُرسل إن وُجد |
| `ping` | `{}` |
| `tools/list` | `{ tools: [{ name, description, inputSchema }] }` — `inputSchema` مُشتق من `ToolDescriptor.input` (حقول نصية/عددية/منطقية) |
| `tools/call` | `{ name, arguments }` ⇒ `{ content: [{ type: "text", text }], structuredContent, isError }` |
| إشعار (بلا id) | لا استجابة — 202 |

| الخطأ (JSON-RPC) | الكود | متى |
| --- | --- | --- |
| parse/invalid | `-32700` / `-32600` | جسم غير صالح أو ليس JSON-RPC |
| method not found | `-32601` | method مجهول |
| invalid params | `-32602` | أداة مجهولة أو arguments غير كائن |

**التدقيق (مساءلة Replay):** كل `tools/call` يُنشئ AuditEvent:
`action = mcp.call` · `entity_type = mcp_session` · `entity_id = <session>` ·
`meta = { tool, outcome: ok|denied|error, agent: <name|—>, kind: read|write }`.
رفض الكتابة يُضيف أيضًا `action = mcp.write.denied`. إعادة البناء: `audit.list` مُرتَّب بالزمن ⇒ خطوات الجلسة كاملة.

**الجلسة:** ترويسة `Mcp-Session-Id` (تُستقبل من العميل أو تُولَّد وتُعاد في الرد على `initialize`).

---

## 5. محوّل PostgreSQL — العقد التقني

| البند | القرار |
| --- | --- |
| الواجهة | `createPostgresRepos(dsn: string, seedIfEmpty?: boolean): Repos` — متزامنة بالضبط كـ`createFileJsonRepos` |
| المخطط | جدول واحد `l27_store(id, doc JSONB, version, updated_at)` — `schema.sql` |
| الجسر | `lib/persistence/sync-pg.ts` → أبن `lib/persistence/pg-child.mjs` عبر `spawnSync` (يحمي الواجهة المتزامنة بلا إعادة كتابة domain) |
| القراءة | `getRepos()` يستعلم عن المستند الطازج في كل استدعاء — نفس اتساق عوالم module في وضع file |
| الكتابة | write-through بعد كل mutation (نفس قائمة اللف في `withWriteThrough`) |
| البذر | مستند مفقود ⇒ `seededStoreFrom()` أو `emptyStore()` ثم حفظ فوري |
| البيئة | `L27_STORE=postgres` + `DATABASE_URL` (اختبارات حية: `L27_TEST_DATABASE_URL`) |
| متزامنات متعددة | LWW على مستوى المستند — **نفس دلالات `file` موثّقة**؛ CAS/صفوف ععلائقية = تطوير لاحق فوق نفس الواجهة |

---

## 6. البوابات

| البوابة | الأمر | المتوقع |
| --- | --- | --- |
| الأنواع | `npm run typecheck` | نظيف |
| الاختبارات | `npm test` | القديمة (166) + جديدة كلها خضراء |
| البناء | `npm run build` | PASS |
| Smoke | `npm start` ثم `npm run smoke` | خضراء (تشمل فحوص MCP الجديدة) |
| المحوّل الحيّ | CI: خدمة Postgres + `L27_TEST_DATABASE_URL` | عقد persistence خضراء حيّة |
| الوثائق | `npm run readme:check` + `readme:drift` | متزامن |

## 7. الخطوط الحمراء (لا تُساوَم)

- §5 باقية حرفاً: لا انتماء سياسي ولا «درجة إقناع» — على الوكلاء كما على البشر.
- لا كتابة عبر MCP في V5.1 — **حتى لا عبر موافقة** (ذلك V5.2 بعقد مُحدَّث).
- لا سلطة تُضاف للوكيل: التفويض بالجلسة البشرية فقط، والتوثيق دائم.
- الـ98 اختبارًا القديمة + 68 اختبار النواة **لا تُلمس** — أي كسر = رفض الدورة.
