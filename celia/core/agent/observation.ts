/**
 * Celia · core/agent · **الملاحظة** (GEN-2): ما عاد من البوابة — إيصال (مُنفَّذ أو مرفوض) — يُحوَّل إلى ملاحظة خطوة.
 * لا ملاحظة بلا إيصال؛ الاستثناء الوحيد خطأ قبل البوابة (ربط لم يُحلّ) ويُسجَّل كـ ERROR.
 */
import type { EvidenceReceipt } from "../../nexa/index.ts";

export type StepObservation = {
  actionId: string;
  capability: string;
  operation: string;
  outcome: "EXECUTED" | "DENIED";
  deniedAt: string | null;
  ok: boolean;
  verified: boolean;
  reason: string | null;
  codes: string[];
  costUsd: number;
  summary: string;
  /** البيانات المفكوكة (عبر ctx.parseResult) — للفحص والربط فقط؛ لا تدخل الدليل. */
  data: unknown;
  /** الناتج الخام — لتصنيف الفشل (عابر/دائم). */
  raw: unknown;
  evidenceHead: string;
};

export function observe(receipt: EvidenceReceipt, parse?: (capability: string, result: unknown) => unknown): StepObservation {
  const raw = receipt.observation?.result;
  return {
    actionId: receipt.actionId,
    capability: receipt.capability,
    operation: receipt.operation,
    outcome: receipt.outcome,
    deniedAt: receipt.deniedAt,
    ok: receipt.outcome === "EXECUTED" && receipt.observation?.ok === true,
    verified: receipt.verified,
    reason: receipt.reason,
    codes: receipt.policy?.findings.filter((f) => f.severity !== "info").map((f) => f.code) ?? [],
    costUsd: receipt.observation?.costUsd ?? 0,
    summary: receipt.observation?.summary ?? receipt.reason ?? receipt.outcome,
    data: raw === undefined ? null : parse ? parse(receipt.capability, raw) : raw,
    raw,
    evidenceHead: receipt.evidenceHead,
  };
}
