/**
 * Celia · core/task · **النتيجة** (GEN-2): الحقائق تأتي من خطوات مُتحقَّقة ومن قياسات البوابة — لا من قول الوكيل.
 * ما لم يثبت يبقى "unknown"، وعقد النتيجة (nexa/verification) هو الذي يحكم.
 */
import { evaluateOutcome, type Facts, type OutcomeContract, type OutcomeVerdict } from "../../nexa/index.ts";
import type { StepRecord } from "./step.ts";

/** حقائق من الخطوات: الخطوة المتحققة تثبت ما تعلن؛ الخطوة الفاشلة/المحجوبة تجعل حقائقها false صراحةً إن لم تثبتها خطوة أخرى. */
export function factsFromSteps(records: readonly StepRecord[], base: Facts = {}): Facts {
  const facts: Facts = { ...base };
  for (const r of records) for (const k of r.step.establishes) if (r.status === "VERIFIED") facts[k] = true;
  for (const r of records) for (const k of r.step.establishes) if ((r.status === "FAILED" || r.status === "BLOCKED") && facts[k] !== true) facts[k] = false;
  return facts;
}

export const computeOutcome = (contract: OutcomeContract, facts: Facts): OutcomeVerdict => evaluateOutcome(contract, facts);
