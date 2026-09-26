/**
 * مُخدد المعدل — قابل للتبديل (VS5 / مراجعة ما قبل النشر).
 *
 * الواجهة واحدة والخلفية قابلة للاستبدال بلا إعادة كتابة المستهلكين:
 *   - `MemoryRateLimiter` — نافذة منزلقة في الذاكرة: التطوير والاختبار (وكبح محلي).
 *   - `PostgresRateLimiter` — عدّاد نافذة ثابتة في `l27_rate`: **الإنتاج الموزَّع** —
 *     يعمل على Vercel serverless لأن الحالة في القاعدة لا في ذاكرة الحالة.
 *     (الرد على مراجعة ما قبل النشر: مُخدد الذاكرة يبدأ من صفر مع كل cold start.)
 *   - `RedisRateLimiter` لاحقًا = تنفيذ جديد للواجهة نفسها — بلا لمس login/mcp.
 *
 * الاختيار التلقائي: `L27_STORE=postgres` + `DATABASE_URL` ⇒ الموزَّع، وإلا الذاكرة.
 * سلوك الفشل: **fail-open** (القاعدة معطوبة ⇒ سماح + لا حظر) — المُخدد كبح
 * إساءة لا حصن مصادقة؛ إغلاق الحملة ليوم بسبب hiccup أسوأ من رفع الحد مؤقتًا.
 */
import { Pool } from "pg";

export interface RateLimiter {
  /** true = مسموح · false = تجاوز الحد داخل النافذة. */
  check(key: string, limit: number, windowMs: number): Promise<boolean> | boolean;
}

/** نافذة منزلقة في الذاكرة — التطوير/الاختبار. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, number[]>();

  check(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? [];
    const cutoff = now - windowMs;
    const recent = bucket.filter((t) => t > cutoff);
    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

/**
 * عدّاد نافذة ثابتة مشترك عبر PostgreSQL — الإنتاج (Neon/Supabase).
 * UPSERT ذرّي واحد لكل طلب؛ التنظيف الفرصة يحذف النوافذ المنتهية.
 */
export class PostgresRateLimiter implements RateLimiter {
  private pool: Pool;
  private calls = 0;

  constructor(dsn: string) {
    this.pool = new Pool({ connectionString: dsn, max: 1, connectionTimeoutMillis: 3_000 });
  }

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    try {
      const res = await this.pool.query(
        `INSERT INTO l27_rate (bucket_key, window_start, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (bucket_key) DO UPDATE SET
           window_start = EXCLUDED.window_start,
           count = CASE
             WHEN l27_rate.window_start = EXCLUDED.window_start THEN l27_rate.count + 1
             ELSE 1
           END
         RETURNING count`,
        [key, windowStart],
      );
      // تنظيف فرصة للنوافذ المنتهية (1/50 طلبًا) — يبقي الجدول صغيرًا.
      this.calls += 1;
      if (this.calls % 50 === 0) {
        await this.pool.query("DELETE FROM l27_rate WHERE window_start < $1", [
          windowStart - windowMs * 2,
        ]);
      }
      return Number(res.rows[0].count) <= limit;
    } catch {
      return true; // fail-open — موثّق أعلاه
    }
  }
}

const memoryLimiter = new MemoryRateLimiter();
let sharedPostgres: PostgresRateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (process.env.L27_RATE_BACKEND === "memory") return memoryLimiter;
  const dsn = process.env.DATABASE_URL ?? "";
  if (process.env.L27_STORE === "postgres" && dsn) {
    if (!sharedPostgres) sharedPostgres = new PostgresRateLimiter(dsn);
    return sharedPostgres;
  }
  return memoryLimiter;
}

/** المُدخل الوحيد للمستهلكين (login / mcp) — الخلفية تُختار وراءه. */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  return getRateLimiter().check(key, limit, windowMs);
}

/** للاختبارات — يمسح الذاكرة المحلية. */
export function resetRateLimits(): void {
  memoryLimiter.reset();
}
