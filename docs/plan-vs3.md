# خطة VS3 — نواة الحملة الإدارية (مُثبَّتة كما نُفِّذت)

العقد: `docs/contract-vs3.md` — **LOCKED عند 02ccc97 قبل التنفيذ**.

## تفسيرات ضيقة (بلا إعادة تفسير العقد)

1. Campaign = سياق singleton مُبذَّر — GET يعيده وPATCH يحدّث الاسم وحده.
2. تاريخ الدورة: تاريخ ISO صالح (2020..2100) — بلا قيود ماضٍ/مستقبل إضافية.
3. PATCH المستخدم: name/role/team/region فقط — البريد وكلمة المرور غير قابلين للتعديل (v1).
4. إبطال الجلسات عند **تغيير الدور وحده** (session_epoch += 1) — تغيير الاسم/الفريق لا يطرد الجلسات.
5. GET endpoints الإدارية تتطلب `settings:manage` (شاشات الإدارة وحدها).

## مراحل التنفيذ والبوابات

| المرحلة | المخرج | البوابة |
| --- | --- | --- |
| P0 | توسيع policy/interfaces/persistence (campaign+cycles+session_epoch) | typecheck |
| P1 | domain: campaign/cycle/users validation + unit tests (incl. §5 على المستخدمين) | unit خضراء |
| P2 | persistence contract موسّع (create/read/update للدورات والمستخدمين ×محوّلَين) | contract خضراء |
| P3 | session_epoch في token + policy tests | unit خضراء |
| P4 | services (settings/users) + 7 API routes + integration (happy/invalid/authz/audit) | integration خضراء |
| P5 | UI: /admin + /admin/users + تنقّل | typecheck+build |
| P6 | smoke موسّع (12 فحصاً) + CI | smoke 19+12 |
| P7 | CHANGE→COMMIT→PUSH→VERIFY_REMOTE + CI watch | مطابقة ثلاثية |

## خطة الاختبارات

```text
tests/unit/admin-validation.test.ts    region/team/cycle/campaign/user + رفض §5 على user
tests/unit/policy.test.ts              + settings:manage لكل الأدوار الستة
tests/unit/auth-session.test.ts        + ep roundtrip
tests/integration/api-admin-settings   campaign/cycles/regions/teams happy+invalid+authz+audit
tests/integration/api-users            create→login + dup409 + role-change→401 قديمة + authz + بلا password_hash
tests/smoke/smoke.mjs                  +12: /admin, تعديل حملة, دورة, منطقة+فريق,
                                       مستخدم جديد يدخل, تغيير دور يطرد الجلسة, coordinator 403
```

## خريطة Evidence لـAC-16

| AC | Artifact |
| --- | --- |
| 1-4 إعدادات تُخزَّن + audit | api-admin-settings (integration) + smoke |
| 5 مستخدم جديد يدخل | api-users create→login + smoke login |
| 6 تغيير الدور يطرد الجلسة | api-users (old cookie 401) + smoke |
| 7 Coordinator 403 | api-admin + api-users + smoke |
| 8 رفض غير الصالح | api-admin + api-users (400/409) |
| 9 audit لكل mutation | api-admin + api-users (عدّاد أحداث) |
| 10 تنقّل UX | smoke (HTML) — التنفيذ مثبت في 7 |
| 11-16 | typecheck / tests / build / smoke / CI / VERIFY_REMOTE — نفس بوابة VS2 |

## خارج النطاق (مؤكَّد)

تعديل بريد/كلمة مرور، حذف كيانات، VoterRecord، Assign Task UI، كل §13.
