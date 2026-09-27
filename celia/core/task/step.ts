/**
 * Celia · core/task · **الخطوة** (GEN-2): ما تريد الخطة إثباته، وبأي قدرات (مرتبة)، وما التوقّع الذي يُحكم به.
 *
 * الخطوة لا تنادي مزوّدًا. المرشح `CapabilityChoice` هو اقتراح يُقدَّم إلى بوابة NEXA، والبوابة تقرر.
 * الوسائط قد تُربط بمخرجات خطوة سابقة عبر `{ $bind: "<stepId>.<path>" }` — تُحلّ وقت التنفيذ لا وقت التخطيط.
 */
import type { DataClass, RiskLevel } from "../../nexa/index.ts";

export type Binding = { $bind: string; limit?: number };
export const isBinding = (v: unknown): v is Binding => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Binding).$bind === "string";

export type CapabilityChoice = {
  capability: string;
  operation: string;
  arguments: Record<string, unknown>;
  risk: RiskLevel;
  dataClass: DataClass;
  /** سقف الإنفاق لهذا الاقتراح؛ غيابه = DEFAULT_SPEND_CAP_USD (0). */
  maxCostUsd?: number;
  note?: string;
};

/** التوقّع الذي يُحكم به على الملاحظة (تصريحي — قابل للحفظ والإعادة). */
export type Expectation = {
  /** الملاحظة ok (افتراضيًا مطلوب). */
  ok?: boolean;
  /** إيصال البوابة verified (الملاحظة متسقة مع الاقتراح). */
  verified?: boolean;
  /** مسارات يجب أن توجد في البيانات المفكوكة. */
  has?: string[];
  /** حدّ أدنى لعدد العناصر عند مسار. */
  minCount?: { path: string; min: number };
};

export type PlanStep = {
  id: string;
  title: string;
  /** الحقائق التي تثبت true عندما تُتحقق الخطوة. */
  establishes: string[];
  /** مرشحون بالترتيب — يُجرَّب التالي عند إعادة التخطيط. */
  candidates: CapabilityChoice[];
  expect: Expectation;
  /** إعادات المحاولة للمرشح نفسه عند فشل عابر (افتراضيًا 1). */
  maxRetries?: number;
};

export type StepStatus = "PENDING" | "RUNNING" | "VERIFIED" | "FAILED" | "BLOCKED";
export type AttemptOutcome = "EXECUTED" | "DENIED" | "ERROR";
export type StepVerdict = "VERIFIED" | "NOT_VERIFIED" | "FAILED";

export type StepAttempt = {
  seq: number;
  stepId: string;
  planVersion: number;
  candidateIndex: number;
  capability: string;
  operation: string;
  /** معرّف فعل البوابة (إيصال) — null فقط عند خطأ قبل البوابة (ERROR). */
  actionId: string | null;
  outcome: AttemptOutcome;
  deniedAt: string | null;
  ok: boolean;
  verdict: StepVerdict;
  reason: string;
  codes: string[];
  retry: boolean;
  at: string;
  evidenceHead: string | null;
};

export type StepRecord = {
  step: PlanStep;
  status: StepStatus;
  candidateIndex: number;
  retries: number;
  attempts: StepAttempt[];
  /** البيانات المفكوكة من الملاحظة المتحققة — تُستخدم للربط؛ لا تدخل رسم الدليل. */
  data: unknown;
};

export const newStepRecord = (step: PlanStep): StepRecord => ({ step, status: "PENDING", candidateIndex: 0, retries: 0, attempts: [], data: null });
