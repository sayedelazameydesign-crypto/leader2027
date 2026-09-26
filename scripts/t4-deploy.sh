#!/usr/bin/env bash
# T4 — النشر على Vercel + Neon. **الأسرار تُقرأ من shell فقط** — لا تُطبع ولا
# تُمرَّر كوسائط ولا تمر عبر المحادثة أبدًا (نفس درس بيانات الدخول).
#
# المتطلبات (في shell قبل التشغيل):
#   VERCEL_TOKEN=…            (أو تكون `npx vercel login` قد أُنجزت مسبقًا)
#   DATABASE_URL=…            (Neon pooled DSN — ينتهي مضيفه بـ -pooler.aws.neon.tech)
#   L27_T4_LOGIN_EMAIL/PASSWORD  (مالك bootstrap للتحقق الحيّ — اختياري)
#
# الاستخدام:
#   bash scripts/t4-deploy.sh deploy     # نشر مرحلة التحقق (بذور العرض مفعّلة للـsmoke)
#   bash scripts/t4-deploy.sh finalize   # إغلاق: إلغاء البذر + L27_ALLOWED_HOSTS + إعادة النشر
set -euo pipefail

phase="${1:-deploy}"
: "${DATABASE_URL:?DATABASE_URL مطلوب — ضعه في shell فقط (لا ترسله في أي محادثة)}"

# بند 5: التأكيد فقط — لا قيمة تُطبع أبدًا
case "$DATABASE_URL" in
  *-pooler*) echo "T4-5 pooler: yes" ;;
  *) echo "T4-5 pooler: NO — استعمل رابط -pooler الموزّع من Neon"; exit 1 ;;
esac

# بند 4: الذاكرة في الإنتاج يجب أن تكون غائبة
if [ "${L27_RATE_BACKEND:-}" = "memory" ]; then
  echo "T4-4: L27_RATE_BACKEND=memory مُعرَّف — احذفه (الافتراضي postgres)"; exit 1
fi
echo "T4-4 L27_RATE_BACKEND: absent ✓"

if [ "$phase" = "deploy" ]; then
  secret="${L27_SESSION_SECRET:-$(openssl rand -base64 48)}"
  demo_pw="${L27_DEMO_PASSWORD:-$(openssl rand -hex 12)}"
  npx --yes vercel@latest link --yes
  printf '%s' "$secret"       | npx --yes vercel@latest env add L27_SESSION_SECRET production
  printf '1'                  | npx --yes vercel@latest env add L27_TRUST_EDGE production
  printf 'postgres'           | npx --yes vercel@latest env add L27_STORE production
  printf '%s' "$DATABASE_URL" | npx --yes vercel@latest env add DATABASE_URL production
  # مرحلة التحقق فقط — تُلغى في finalize (T4-7)
  printf '1'                  | npx --yes vercel@latest env add L27_SEED_DEMO_ACCOUNTS production
  printf '%s' "$demo_pw"      | npx --yes vercel@latest env add L27_DEMO_PASSWORD production
  echo "✅ L27_SESSION_SECRET ≥32 عشوائي و L27_DEMO_PASSWORD مُدوَّر — ولن يُطبعا أبدًا"
  npx --yes vercel@latest deploy --prod
elif [ "$phase" = "finalize" ]; then
  npx --yes vercel@latest env rm L27_SEED_DEMO_ACCOUNTS production --yes || true
  npx --yes vercel@latest env rm L27_DEMO_PASSWORD production --yes || true
  domain="${L27_T4_DOMAIN:?L27_T4_DOMAIN مطلوب (نطاق النشر)}"
  printf '%s' "$domain" | npx --yes vercel@latest env add L27_ALLOWED_HOSTS production
  npx --yes vercel@latest deploy --prod
  echo "✅ finalize: البذر مُلغى + L27_ALLOWED_HOSTS=$domain"
else
  echo "deploy | finalize"; exit 1
fi
