/**
 * Celia · core/task · **آلة حالة المهمة** (GEN-2 + امتداد GEN-3).
 *
 * الوكيل ليس حرًّا: كل انتقال مُعلَن هنا، وما ليس هنا لا يحدث — لا قفزة PLANNING → COMPLETED،
 * وCOMPLETED/PARTIAL لا يُبلَغان إلا من VERIFYING (أي بعد حكم عقد النتيجة). الحالات النهائية لا تخرج منها المهمة.
 *
 *   CREATED → UNDERSTANDING → PLANNING → READY → EXECUTING → OBSERVING → VERIFYING
 *                                                         ├─ FAILED       → RECOVERING → (EXECUTING | REPLANNING | FAILED)
 *                                                         ├─ NOT_VERIFIED → REPLANNING → (READY | BLOCKED | FAILED)
 *                                                         └─ VERIFIED     → READY (خطوة تالية) | COMPLETED | PARTIAL (العقد يحكم)
 *   GEN-3: PLANNING | READY → WAITING_APPROVAL → (READY | REPLANNING | BLOCKED) — قبل EXECUTING فقط، أبدًا بعد VERIFYING.
 *   GEN-3: BLOCKED نهائي بلا إعادة تلقائية (ما رفضته NEXA لا يُعاد كما هو).
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
  "WAITING_APPROVAL",
  "COMPLETED",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_STATES: readonly TaskState[] = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED"];
export const isTerminal = (s: TaskState): boolean => TERMINAL_STATES.includes(s);

/** الانتقالات المشروعة — الجدول هو القانون؛ الكود يستشيره ولا يتجاوزه. */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  CREATED: ["UNDERSTANDING"],
  UNDERSTANDING: ["PLANNING", "BLOCKED"],
  PLANNING: ["READY", "WAITING_APPROVAL", "BLOCKED"],
  READY: ["EXECUTING", "WAITING_APPROVAL", "VERIFYING"],
  EXECUTING: ["OBSERVING"],
  OBSERVING: ["VERIFYING"],
  VERIFYING: ["READY", "RECOVERING", "REPLANNING", "COMPLETED", "PARTIAL", "FAILED", "BLOCKED"],
  RECOVERING: ["EXECUTING", "REPLANNING", "FAILED"],
  REPLANNING: ["READY", "BLOCKED", "FAILED"],
  WAITING_APPROVAL: ["READY", "REPLANNING", "BLOCKED"],
  COMPLETED: [],
  PARTIAL: [],
  BLOCKED: [],
  FAILED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new NexaError("TASK_TRANSITION", `illegal task transition ${from} → ${to} (allowed: ${TASK_TRANSITIONS[from].join(",") || "none — terminal"})`);
}
