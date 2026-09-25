# Leader 2027

منصة إنتاجية لإدارة الحسابات والبيانات — لوحة قيادة واحدة.

**الحالة:** v0.1.0 — أول vertical slice مكتملة (واجهة ← API ← بيانات ← اختبارات ← جاهزية نشر).

## التشغيل

```bash
npm install
npm run dev        # تطوير على http://localhost:3000
npm run build      # بناء إنتاجي
npm start          # تشغيل الإنتاج على 0.0.0.0:3000
npm test           # اختبارات الوحدة (vitest)
npm run typecheck  # فحص TypeScript
```

## البنية (الشريحة الأولى)

```text
app/page.tsx              واجهة لوحة القيادة
app/api/health/route.ts   فحص صحة الخدمة
app/api/stats/route.ts    المقاييس + ملخص محسوب
lib/data.ts               طبقة بيانات تجريبية (تُستبدل بقاعدة بيانات لاحقاً)
lib/stats.ts              دوال حساب نقية + اختباراتها
components/LiveDashboard  جلب حي للبيانات في المتصفح
.github/workflows/ci.yml  فحص CI على كل push (typecheck + test + build)
```

## النشر على Vercel

1. افتح [vercel.com/new](https://vercel.com/new) واربط حساب GitHub (مرة واحدة).
2. استورد المستودع `sayedelazameydesign-crypto/leader2027` — يكتشف Next.js تلقائياً.
3. اضغط **Deploy** — وكل push على `main` ينشر تلقائياً.

أو من الطرفية: `npx vercel` (يتطلب تسجيل دخول Vercel مرة واحدة من جهازك).

## المزامنة مع GitHub

آلية المزامنة مثبتة عملياً بدورة `CHANGE → COMMIT → PUSH → VERIFY_REMOTE` —
انظر [docs/sync-verification.md](docs/sync-verification.md).
