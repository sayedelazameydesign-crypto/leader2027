/**
 * Celia · core/task · **آلة حالة المهمة** (GEN-2).
 *
 * الوكيل ليس حرًّا: كل انتقال مُعلَن هنا، وما ليس هنا لا يحدث — لا قفزة PLANNING → COMPLETED،
 * وCOMPLETED لا يُبلَغ إلا من VERIFYING (أي بعد حكم عقد النتيجة). الحالات النهائية لا تخرج منها المهمة.
 *
 *   CREATED → UNDERSTANDING → PLANNING → READY → EXECUTING → OBSERVING → VERIFYING
 *                                                         ├─ FAILED       → RECOVERING → (EXECUTING | REPLANNING | FAILED)
 *                                                         ├─ NOT_VERIFIED → REPLANNING → (READY | BLOCKED | FAILED)
 *                                                         └─ VERIFIED     → READY (خطوة تالية) | COMPLETED (العقد مُستوفى)
 */
import { NexaError } from "../../nexa/index.ts";

export const TASK_STATES = [
  "CREATED",
  "UNDERSTANDING",
  "PLANNING",
  "READY",
  "EXECUTING",
  "OBSERVING",
  "VERIFYING",
  "RECOVERING",
  "REPLANNING",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_STATES: readonly TaskState[] = ["COMPLETED", "BLOCKED", "FAILED"];
export const isTerminal = (s: TaskState): boolean => TERMINAL_STATES.includes(s);

/** الانتقالات المشروعة — الجدول هو القانون؛ الكود يستشيره ولا يتجاوزه. */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  CREATED: ["UNDERSTANDING"],
  UNDERSTANDING: ["PLANNING", "BLOCKED"],
  PLANNING: ["READY", "BLOCKED"],
  READY: ["EXECUTING", "VERIFYING"],
  EXECUTING: ["OBSERVING"],
  OBSERVING: ["VERIFYING"],
  VERIFYING: ["READY", "RECOVERING", "REPLANNING", "COMPLETED", "FAILED", "BLOCKED"],
  RECOVERING: ["EXECUTING", "REPLANNING", "FAILED"],
  REPLANNING: ["READY", "BLOCKED", "FAILED"],
  COMPLETED: [],
  BLOCKED: [],
  FAILED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new NexaError("TASK_TRANSITION", `illegal task transition ${from} → ${to} (allowed: ${TASK_TRANSITIONS[from].join(",") || "none — terminal"})`);
}
