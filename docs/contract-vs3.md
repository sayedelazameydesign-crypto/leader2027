# PRODUCT CONTRACT — VS3: نواة الحملة الإدارية (بقية P1)

**الحالة: LOCKED** — قبل أي سطر تنفيذ. المصدر: مقترح VS3 المعتمد (بقية P1 من Feature Map)
بدون توسيع نطاق ولا إعادة تفسير العقد الأم (§5 و§13 و§4 باقية حرفاً).

## النطاق

إغلاق النواة الإدارية التي بُنيت بذورها في VS2:

```text
Campaign          الحملة (سياق singleton في v1)
ElectionCycle     الدورة/الاستحقاق الانتخابي
Regions/Teams     إنشاء وإدارة (كانا seed فقط)
Users             إنشاء مستخدم + تعديل دور/فريق (شاشة كاملة)
Session hardening إبطال الجلسات القديمة عند تغيير الدور (session_epoch)
```

## الكيانات الجديدة

| الكيان | الحقول |
| --- | --- |
| `Campaign` | id, name (2-80), created_at, updated_at |
| `ElectionCycle` | id, name (2-80), election_date (YYYY-MM-DD), status ∈ {planned, active, closed}, created_at, updated_at |

`User` يكتسب `session_epoch: number` — والتوكن يحمل `ep`؛ mismatch → 401.

## الصلاحيات

- إجراء جديد: **`settings:manage`** = OWNER / CAMPAIGN_ADMIN / CAMPAIGN_MANAGER فقط —
  لكل ما عدا المستخدمين (Campaign/Cycles/Regions/Teams — قراءة وكتابة).
- المستخدمون: الإجراء الموجود **`users:manage`** = Manager+ (إنشاء + تعديل اسم/دور/فريق/منطقة).
- تغيير الدور = `session_epoch += 1` = إبطال كل الجلسات السابقة فوراً.
- بقية صفوف مصفوفة §4 دون تغيير. لا إخفاء أزرار كـauthorization.

## API (VS3)

```http
GET   /api/campaign          PATCH /api/campaign
GET   /api/cycles            POST  /api/cycles        PATCH /api/cycles/:id
GET   /api/regions           POST  /api/regions
GET   /api/teams             POST  /api/teams
GET   /api/users             POST  /api/users         PATCH /api/users/:id
```

- رقيقة فوق domain services — كل mutation ينشئ AuditEvent.
- `password_hash` لا يظهر في أي استجابة إطلاقاً.
- الإنشاء: name + email فريد + password ≥ 8 + role ∈ ROLES + team/region اختياريان.
- PATCH مستخدم: name? / role? / team_id? / region_id? — **البريد وكلمة المرور غير قابلين للتعديل في v1**.

## الواجهات

```text
/admin        الحملة + الدورات + المناطق + الفرق   (settings:manage — والرفض برسالة صريحة)
/admin/users  جدول المستخدمون + إنشاء + تعديل دور/فريق (users:manage)
```

رابط «الإدارة» في التنقّل يظهر لـManager+ (UX فقط — التنفيذ على الخادم).

## قواعد البيانات والقيود (كما هي)

- §5: رفض صريح لكل حقول التفضيل السياسي الأربعة — **ويمتد الآن إلى إنشاء المستخدمين**.
- §13: القائمة السوداء باقية حرففاً.
- المرجعيات تُتحقق من الصحة (team/region موجودان).

## Acceptance Criteria

```text
[ ] 1  Manager يفتح /admin ويرى الحملة
[ ] 2  تعديل اسم الحملة → يُخزَّن + audit
[ ] 3  إنشاء دورة انتخابية → تُخزَّن + audit
[ ] 4  إنشاء منطقة + فريق → يُخزَّنان ويظهران في القوائم فوراً
[ ] 5  إنشاء مستخدم بدور → يستطيع الدخول فعلياً
[ ] 6  تغيير الدور → الجلسة القديمة تُرفض 401 (session_epoch)
[ ] 7  Coordinator مرفوض من admin APIs (403)
[ ] 8  payloads غير صالحة مرفوضة (بريد خاطئ/مكرر 409/دور مجهول/كلمة مرور <8/تاريخ دورة خاطئ)
[ ] 9  كل admin mutation ينشئ audit event بفاعل صحيح
[ ] 10 التنقّل يخفي الإدارة عن غير Manager (UX — التنفيذ مثبت في 7)
[ ] 11 typecheck PASS
[ ] 12 tests PASS
[ ] 13 build PASS
[ ] 14 production smoke PASS
[ ] 15 CI PASS
[ ] 16 remote SHA verified (CHANGE→COMMIT→PUSH→VERIFY_REMOTE)
```

## خارج VS3 (صراحة)

❌ تعديل بريد/كلمة مرور المستخدم (v2) ❌ حذف كيانات ❌ VoterRecord ❌ كل §13
❌ أي UI لـAssign Task (P3) ❌ تغيير مصفوفة §4 القائمة.
