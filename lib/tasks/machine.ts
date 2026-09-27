/**
 * GEN-3 — آلة الحالة الموسّعة (البنية وحدها تحكم الشرعية).
 *
 * ```
 * CREATED → UNDERSTANDING → PLANNING → READY → EXECUTING → OBSERVING → VERIFYING
 *   VERIFYING ⇒ { COMPLETED | PARTIAL | RECOVERING → REPLANNING → READY … }
 *   PLANNING | READY ⇒ WAITING_APPROVAL ⇒ { READY | BLOCKED | REPLANNING }
 * ```
 *
 * امتدادان موثّقان عن العمود الفقري الأحادي:
 *  - `OBSERVING → READY`: بقيت خطوات ⇒ جاهزية للتالية (الحلقة: READY→EXECUTING→
 *    OBSERVING→READY… — والمرور بـREADY يُبقي طلب الموافقة mid-plan شرعيًا per R1).
 *  - `REPLANNING → REPLANNING`: صياغة الخطة (checkpointed refinement — تُستبدل الخطة وتبقى الحالة).
 */
import type { TaskStatus } from "@/lib/repositories/interfaces";
import { TaskEngineError } from "./types";

export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  CREATED: ["UNDERSTANDING"],
  UNDERSTANDING: ["PLANNING"],
  PLANNING: ["READY", "WAITING_APPROVAL"],
  READY: ["EXECUTING", "WAITING_APPROVAL"],
  EXECUTING: ["OBSERVING"],
  OBSERVING: ["READY", "VERIFYING"],
  VERIFYING: ["COMPLETED", "PARTIAL", "RECOVERING"],
  RECOVERING: ["REPLANNING"],
  REPLANNING: ["READY", "REPLANNING"],
  WAITING_APPROVAL: ["READY", "BLOCKED", "REPLANNING"],
  COMPLETED: [],
  PARTIAL: [],
  BLOCKED: [],
};

const TERMINAL: readonly TaskStatus[] = ["COMPLETED", "PARTIAL", "BLOCKED"];

/** حالة نهائية — لا خروج منها (R4/R5). */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * حارس الانتقال الوحيد — كل طرق المحرك تمرّ من هنا.
 * غير الشرعي ⇒ رفض صريح، بلا انتقال وبلا checkpoint (لا استمرار صامت).
 */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = TRANSITIONS[from];
  if (!allowed) {
    throw new TaskEngineError("task.state.unknown", `حالة مهمة غير معروفة: "${from}"`);
  }
  if (!allowed.includes(to)) {
    throw new TaskEngineError(
      "task.transition.illegal",
      `انتقال غير شرعي بنيويًا: ${from} → ${to} — رُفض بلا أي أثر`,
    );
  }
}
