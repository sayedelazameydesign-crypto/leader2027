/**
 * GEN-3 — التجزئة الحتمية (امتداد GEN-2، تُمدَّد ولا تتغيّر).
 *
 * القواعد:
 *  - كل تجزئة SHA-256 فوق ترتيب قانوني (canonical) مرتب المفاتيح بعمق كامل.
 *  - بادئة إصدار لكل نطاق (`GEN3/…/v1`) — أي تغيير مستقبلي نسخة جديدة لا كسر صامت.
 */
import { createHash } from "node:crypto";
import type { TaskStatus } from "@/lib/repositories/interfaces";

/** الترتيب القانوني — JSON بمفاتيح مرتبة بعمق كامل (حتمي عبر العمليات). */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** بصمة المقترح القانوني — تُخزَّن بدل المقترح الخام (D6: لا أسرار في المخزن). */
export function proposalHash(proposal: Record<string, unknown>): string {
  return sha256hex(`GEN3/PROPOSAL/v1|${canonicalize(proposal)}`);
}

/** جذرا السلسلتين — ثابتان ومعلَنان (GEN-2 نفسه). */
export const CHECKPOINT_GENESIS = "GENESIS";
export const EVIDENCE_GENESIS = "EVIDENCE-GENESIS";

export type CheckpointHashInput = {
  prevHash: string;
  taskId: string;
  seq: number;
  state: TaskStatus;
  stepId: string | null;
  context: Record<string, unknown>;
  evidenceHead: string;
  at: string;
};

/** تجزئة checkpoint واحد — تربطه بسابقه وبالسياق ورأس الدليل. */
export function checkpointHash(input: CheckpointHashInput): string {
  return sha256hex(
    [
      "GEN3/CHECKPOINT/v1",
      input.prevHash,
      input.taskId,
      String(input.seq),
      input.state,
      input.stepId ?? "",
      canonicalize(input.context),
      input.evidenceHead,
      input.at,
    ].join("|"),
  );
}

/** تمديد سلسلة الدليل — كل خطوة verified تُدخل السلسلة نفسها. */
export function evidenceHash(prevHead: string, stepId: string, evidence: unknown): string {
  return sha256hex(`GEN3/EVIDENCE/v1|${prevHead}|${stepId}|${canonicalize(evidence)}`);
}
