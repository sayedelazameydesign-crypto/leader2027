# توثيق التحقق من مزامنة GitHub (Sync Verification)

**الغرض:** تثبيت آلية المزامنة كـ *سلوك مُختبَر* (وليس افتراضًا) عبر دورة كاملة:
`CHANGE → COMMIT → PUSH → VERIFY_REMOTE`

- **التاريخ:** 2026-09-25
- **الفرع:** `arena/01a0da49-leader2027`
- **المستودع:** `https://github.com/sayedelazameydesign-crypto/leader2027`

## الادعاء السابق (المُصحَّح)

- ❌ «كل تغيير يُرفع تلقائيًا على GitHub» — لم يكن مُثبتًا، وسُحب.
- ✅ تغييرات شجرة العمل تُحفظ تلقائيًا في جلسة العمل (patchset) — سلوك المنصة وليس رفع GitHub.
- ✅ رفع GitHub يتم **صراحةً** عبر `git commit` + `git push`، وهذا ما تثبته الدورة أدناه.

## بروتوكول الاختبار

1. **CHANGE** — إنشاء/تعديل ملف في شجرة العمل.
2. **COMMIT** — `git commit` وتسجيل SHA المحلي (`git rev-parse HEAD`).
3. **PUSH** — `git push origin arena/01a0da49-leader2027`.
4. **VERIFY_REMOTE** — إثبات المطابقة على GitHub:
   - `git ls-remote origin refs/heads/arena/01a0da49-leader2027`
   - `gh api repos/sayedelazameydesign-crypto/leader2027/commits/<local_sha>`
   - إثبات وجود هذا الملف نفسه على الفرع البعيد.

## معيار النجاح

```text
local_HEAD == remote_ref == gh_api_commit
AND docs/sync-verification.md exists on remote branch
```

SHAs المطابقة لهذه الدورة مسجّلة في `git log` وفي تقرير الجلسة.
