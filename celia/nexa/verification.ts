/**
 * NEXA — عقد النتيجة (Outcome Contract) والتحقق (§6).
 *
 * المهمة لا تُعدّ منجزة لأن الوكيل قال ذلك — بل لأن الحقائق المطلوبة ثبتت (true)،
 * والممنوعة لم تقع (false)، ولا مجهول بينها. الحقيقة المفقودة = "unknown" لا false.
 *
 *   forbidden=true          ⇒ FAILED
 *   blocker=true            ⇒ BLOCKED
 *   required=false (بعضها)  ⇒ PARTIAL إن تحقق بعضها، وإلا FAILED
 *   أي مجهول (مطلوب/ممنوع/عائق) ⇒ NOT_VERIFIED
 *   وإلا                    ⇒ COMPLETED
 */
import { NexaError, type OutcomeStatus } from "./protocol.ts";

export type Fact = boolean | "unknown";
export type Facts = Record<string, Fact>;

export type OutcomeContract = {
  goal: string;
  required: string[];
  forbidden: string[];
  /** حقائق إن صحّت أوقفت المهمة (مثل غياب السرّ) — الحكم BLOCKED لا FAILED. */
  blockers?: string[];
};

export type OutcomeVerdict = {
  status: OutcomeStatus;
  met: string[];
  unmet: string[];
  unknown: string[];
  violated: string[];
  blocked: string[];
  reasons: string[];
};

export function parseContract(value: unknown): OutcomeContract {
  const r = value as Partial<OutcomeContract> | null;
  if (!r || typeof r !== "object") throw new NexaError("BAD_CONTRACT", "contract must be an object");
  if (typeof r.goal !== "string" || !r.goal) throw new NexaError("BAD_CONTRACT", "contract.goal must be a non-empty string");
  const list = (k: "required" | "forbidden" | "blockers", optional = false): string[] => {
    const v = r[k];
    if (v === undefined && optional) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x)) throw new NexaError("BAD_CONTRACT", `contract.${k} must be a string[]`);
    return v;
  };
  const required = list("required");
  const forbidden = list("forbidden");
  const blockers = list("blockers", true);
  if (required.length === 0) throw new NexaError("BAD_CONTRACT", "contract.required must not be empty (a contract with nothing required verifies nothing)");
  const overlap = required.filter((x) => forbidden.includes(x));
  if (overlap.length) throw new NexaError("BAD_CONTRACT", `facts both required and forbidden: ${overlap.join(",")}`);
  return { goal: r.goal, required, forbidden, blockers };
}

const factOf = (facts: Facts, key: string): Fact => (key in facts ? facts[key]! : "unknown");

export function evaluateOutcome(contract: OutcomeContract, facts: Facts): OutcomeVerdict {
  const met: string[] = [];
  const unmet: string[] = [];
  const unknown: string[] = [];
  const violated: string[] = [];
  const blocked: string[] = [];
  const reasons: string[] = [];

  for (const k of contract.required) {
    const f = factOf(facts, k);
    if (f === true) met.push(k);
    else if (f === false) unmet.push(k);
    else unknown.push(k);
  }
  for (const k of contract.forbidden) {
    const f = factOf(facts, k);
    if (f === true) violated.push(k);
    else if (f === "unknown") unknown.push(k);
  }
  for (const k of contract.blockers ?? []) {
    const f = factOf(facts, k);
    if (f === true) blocked.push(k);
    else if (f === "unknown") unknown.push(k);
  }

  let status: OutcomeStatus;
  if (violated.length) {
    status = "FAILED";
    reasons.push(`forbidden fact(s) occurred: ${violated.join(",")}`);
  } else if (blocked.length) {
    status = "BLOCKED";
    reasons.push(`blocker(s) present: ${blocked.join(",")}`);
  } else if (unmet.length) {
    status = met.length ? "PARTIAL" : "FAILED";
    reasons.push(`required fact(s) false: ${unmet.join(",")}`);
  } else if (unknown.length) {
    status = "NOT_VERIFIED";
    reasons.push(`unknown fact(s): ${unknown.join(",")}`);
  } else {
    status = "COMPLETED";
    reasons.push(`all ${met.length} required facts true; ${contract.forbidden.length} forbidden facts false`);
  }
  return { status, met, unmet, unknown, violated, blocked, reasons };
}

export function formatVerdict(v: OutcomeVerdict): string {
  return `OUTCOME=${v.status} met=${v.met.length} unmet=${v.unmet.length} unknown=${v.unknown.length} violated=${v.violated.length} blocked=${v.blocked.length} :: ${v.reasons.join("; ")}`;
}
