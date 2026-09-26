/**
 * مُخدد المعدل — قابل للتبديل (VS5 / مراجعة ما قبل النشر).
 *
 * الواجهة واحدة والخلفية قابلة للاستبدال بلا إعادة كتابة المستهلكين:
 *   - `MemoryRateLimiter` — نافذة منزلقة في الذاكرة: التطوير والاختبار (وكبح محلي).
 *   - `PostgresRateLimiter` — عدّاد نافذة ثابتة في `l27_rate`: **الإنتاج الموزَّع** —
 *     يعمل على Vercel serverless لأن الحالة في القاعدة لا في ذاكرة الحالة.
 *   - `RedisRateLimiter` لاحقًا = تنفيذ جديد للواجهة نفسها — بلا لمس login/mcp.
 *
 * الاختيار التلقائي: `L27_STORE=postgres` + `DATABASE_URL` ⇒ الموزَّع، وإلا الذاكرة.
 * `L27_RATE_BACKEND=memory` إلحاح صريح — يُحذَّر منه في الإنتاج (انظر warnOnce).
 *
 * سلوك الفشل: **fail-open** (القاعدة معطوبة ⇒ سماح + لا حظر) — المُخدد كبح
 * إساءة لا حصن مصادقة. لهذا فإن التزاحم فوق سعة الاتصالات **عدو** المُخدد:
 * الاتصالات مُعدَّلة (pool.max=5 + مهلة قصيرة) حتى لا يتكدس الانتظار ثم يذوب
 * في fail-open تحت الحمل. مع Neon استعمل رابط `-pooler` الموزَّع.
 */
import { Pool } from "pg";

export interface RateLimiter {
  /** true = مسموح · false = تجاوز الحد داخل النافذة. */
  check(key: string, limit: number, windowMs: number): Promise<boolean>;
}

function warnOnceFactory(): (msg: string) => void {
  let warned = false;
  return (msg: string) => {
    if (!warned) {
      console.warn(`⚠️ ${msg}`);
      warned = true;
    }
  };
}

/** نافذة منزلقة في الذاكرة — التطوير/الاختبار. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, number[]>();

  async check(key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
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
 * UPSERT ذرّي واحد لكل طلب؛ التنظيف الفرصة يحذف النوافذ المنتهية
 * عبر الفهرس `l27_rate_window_start_idx`.
 */
export class PostgresRateLimiter implements RateLimiter {
  private pool: Pool;
  private calls = 0;
  private ensured: Promise<void> | null = null;

  constructor(dsn: string) {
    // max>1 ضروري: مزامنة كل الطلبات عبر اتصال واحد = تزاحم ⇒ timeout ⇒ fail-open
    // ⇒ المُخدد يذوب تحت الحمل بالضبط حين يُحتاج. المهلة قصيرة لتفضّل الرفض السريع.
    this.pool = new Pool({ connectionString: dsn, max: 5, connectionTimeoutMillis: 1_500 });
  }

  /**
   * يضمن مخططه بنفسه — المُخدد يعمل قبل أي `getRepos()` (طلب مبكر على قاعدة باردة)،
   * والاعتماد على محوّل التخزين لإنشاء الجدول = فشل صامت في fail-open (كشفه اختبار حيّ).
   * عند فشل الضمان تُمحى المحاولة ليُعاد الطلب في الاستدعاء التالي.
   */
  private ensure(): Promise<void> {
    if (!this.ensured) {
      this.ensured = (async () => {
        await this.pool.query(
          `CREATE TABLE IF NOT EXISTS l27_rate (
             bucket_key   TEXT PRIMARY KEY,
             window_start BIGINT NOT NULL,
             count        BIGINT NOT NULL
           )`,
        );
        await this.pool.query(
          "CREATE INDEX IF NOT EXISTS l27_rate_window_start_idx ON l27_rate (window_start)",
        );
      })().catch((err) => {
        this.ensured = null;
        throw err;
      });
    }
    return this.ensured;
  }

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    try {
      await this.ensure();
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
const warnOnce = warnOnceFactory();
let sharedPostgres: PostgresRateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  const dsn = process.env.DATABASE_URL ?? "";
  if (process.env.L27_RATE_BACKEND === "memory") {
    if (process.env.NODE_ENV === "production") {
      warnOnce(
        "L27_RATE_BACKEND=memory فعّال في الإنتاج — المُخدد محلي لكل حالة (يبدأ من صفر مع cold start). استعمله للتجربة فقط.",
      );
    }
    return memoryLimiter;
  }
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
