# خطة VS2 — People + Volunteer + Field Report (مُثبَّتة كما نُفِّذت)

العقد: `PRODUCT CONTRACT — Leader 2027` — التنفيذ P0→P7 على فرع العمل، بلا لمس `main`.

## القرارات التفسيرية (كما طُبِّقت)

1. **«محدود»** = قراءة فقط (list/get) دون create/patch — `tests/unit/policy.test.ts`.
2. **`/login` + `/api/auth/*`** إضافة إثباتية ضرورية لبندَي AC (access + unauthorized).
3. **Persistence** = Repository Interface + `InMemory` + `FileJson` (var/data/db.json).
   القرص ephemeral على Vercel serverless — محولّ PostgreSQL لاحقاً فوق نفس الواجهة.
4. **الجلسة** = cookie موقّع HMAC-SHA256 + كلمات مرور scrypt (`node:crypto`) — صفر اعتمادات جديدة.
5. **«Assign task»** سياسة P3 محجوزة بلا كيان Task في VS2.
6. **§5** = رفض صريح لأي حقل `{assumed_political_preference, predicted_support, political_score, persuadability_score}` — اختبار مخصص لكل حقل.
7. **PATCH التقرير** = ملاحظات (المُنشئ أو Coordinator+) + حالة (Coordinator+ فقط)؛ أي حقل آخر مرفوض.

## البنية المنفَّذة

```text
app/(app)/  dashboard + people + volunteers + field/reports + login
app/api/    people, volunteers, field/reports, stats, auth/{login,logout}, health
lib/domain/ people, volunteers, field, dashboard, stats (نقي)
lib/repositories/  interfaces + container
lib/persistence/   memory + file-json + seed
lib/auth/          password + session + request + page
lib/authorization/ roles + policy
lib/audit/         audit
lib/validation/    result + sensitive (§5)
tests/             unit + integration + smoke
```

## خريطة Evidence لبنود AC الـ17

| AC | Artifact |
| --- | --- |
| 1 شاشة الأشخاص | smoke: `/people` + integration api-people GET |
| 2 إنشاء متطوع | integration api-volunteers POST + smoke POST |
| 3 يُخزَّن | persistence-contract + api read-after-write |
| 4 بعد refresh | api-volunteers طلب منفصل + smoke طلب منفصل |
| 5 إنشاء تقرير | api-field-reports POST + smoke POST |
| 6 التقرير يُخزَّن | persistence-contract + api GET + smoke |
| 7 team/region صالحان | field-report-validation (service) + api 400 + smoke 400 |
| 8 payload غير صالح | api ×3 مجموعات 400 + smoke |
| 9 غير مصرّح | policy unit + api 401/403 + smoke 401/403 |
| 10 audit لكل mutation | flow + api-field-reports |
| 11 dashboard يعكس النشاط | flow + api stats قبل/بعد + smoke |
| 12-14 typecheck/tests/build | CI steps بنفس الأوامر |
| 15 production smoke | `npm run smoke` محلياً وفي CI ضد next start |
| 16 CI PASS | `gh run watch` |
| 17 remote SHA | CHANGE→COMMIT→PUSH→VERIFY_REMOTE |

## خارج VS2 (§13)

AI، WhatsApp، Maps، Push، Payments، Billing، Analytics معقد، Predictive scoring،
Political persuasion، Mobile — و`main` — وVoterRecord المستورد (مراجعة قانونية أولًا).
