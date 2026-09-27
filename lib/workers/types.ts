/**
 * GEN-4 — أنواع طبقة التنفيذ الموزّع (فوق GEN-3، لا داخله).
 *
 * الفلسفة: المنسّق كلّي النتائج (D3) — الرفض التشغيلي قيمة `denied`
 * (R7: غياب lease ⇒ deny مش استثناء). الرمي للأخطاء البرمجية فقط.
 */
import type { TaskAttemptRecord, TaskLeaseRecord, TaskRecord } from "@/lib/repositories/interfaces";

/** صلاحية الـlease الافتراضية: 30 ثانية. */
export const DEFAULT_LEASE_TTL_MS = 30_000;

/** هامش أمان التجديد الافتراضي: 5 ثوانٍ قبل `expiresAt` (R8/D4). */
export const DEFAULT_HEARTBEAT_MARGIN_MS = 5_000;

/** نتيجة مرفوضة — تحمل `code` ثابتًا للفحص الآلي ورسالة عربية للبشر. */
export type Denied = { status: "denied"; code: string; message: string };

export type ClaimOutcome =
  | { status: "claimed"; lease: TaskLeaseRecord; reclaimed: boolean }
  | Denied;

export type HeartbeatOutcome = { status: "ok"; lease: TaskLeaseRecord } | Denied;

export type ReleaseOutcome = { status: "released"; lease: TaskLeaseRecord } | Denied;

/** الفعل الخارجي المؤثِّر (نداء مدفوع/كتابة خارجية) — يُستدعى مرة واحدة فقط. */
export type PaidCall = () => unknown;

export type ExecuteStepInput = {
  /** حكم المنسّق على النتيجة — صريح دائمًا (لا نجاح صامت). */
  verdict: "verified" | "failed";
  observation?: Record<string, unknown>;
  evidence?: unknown;
  artifact?: { type: string; ref: string };
  /**
   * منفِّذ الفعل المدفوع — إلزامي لخطوة NEXA بلا سجل منفَّذ،
   * ويُتجاهَل (لا يُستدعى) عند وجود سجل (exactly-once).
   */
  call?: PaidCall;
};

export type ExecuteOutcome =
  | { status: "ok"; task: TaskRecord; attempt: TaskAttemptRecord | null }
  | { status: "already-verified"; task: TaskRecord }
  | { status: "skipped-duplicate"; task: TaskRecord; attempt: TaskAttemptRecord }
  | Denied;

export type BatchItem = { stepId: string } & ExecuteStepInput;

export type BatchOutcome = {
  /** اكتملت كل البنود (تنفيذًا أو تخطيًا idempotent) بلا توقف. */
  completed: boolean;
  /** بنود نُفِّذت فعلًا في هذه الدفعة (التخطي لا يُحتسَب). */
  applied: number;
  outcomes: Array<{ stepId: string; outcome: ExecuteOutcome }>;
  task: TaskRecord | null;
};

/** خطأ المبرمج — مدخلات فاسدة الأنواع (فارغة/غير كائن). التشغيلي denied لا رمي. */
export class WorkerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
  }
}
