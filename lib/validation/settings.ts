import { fail, ok, type Result } from "./result";
import { rejectPoliticalFields } from "./sensitive";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().startsWith(value) &&
    year >= 2020 &&
    year <= 2100
  );
}

const CYCLE_STATUSES = ["planned", "active", "closed"] as const;
export type CycleStatusInput = (typeof CYCLE_STATUSES)[number];

function political(raw: Record<string, unknown>): Result<never> | null {
  const errors = rejectPoliticalFields(raw);
  return Object.keys(errors).length > 0 ? fail(400, errors) : null;
}

export function validateCampaignPatch(raw: unknown): Result<{ name: string }> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return fail(400, { name: "اسم الحملة بين 2 و80 حرفاً" });
  }
  return ok({ name });
}

export function validateCycleInput(raw: unknown): Result<{
  name: string;
  election_date: string;
  status: CycleStatusInput;
}> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;

  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) errors.name = "اسم الدورة بين 2 و80 حرفاً";

  const election_date = typeof input.election_date === "string" ? input.election_date.trim() : "";
  if (!isIsoDate(election_date)) {
    errors.election_date = "تاريخ الاستحقاق بصيغة YYYY-MM-DD بين 2020 و2100";
  }

  const status = (input.status ?? "planned") as CycleStatusInput;
  if (!(CYCLE_STATUSES as readonly string[]).includes(status)) {
    errors.status = "الحالة planned أو active أو closed";
  }

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok({ name, election_date, status });
}

export function validateCyclePatch(raw: unknown): Result<Partial<{
  name: string;
  election_date: string;
  status: CycleStatusInput;
}>> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;

  const errors: Record<string, string> = {};
  const patch: Partial<{ name: string; election_date: string; status: CycleStatusInput }> = {};

  if ("name" in input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 2 || name.length > 80) errors.name = "اسم الدورة بين 2 و80 حرفاً";
    else patch.name = name;
  }
  if ("election_date" in input) {
    const election_date = typeof input.election_date === "string" ? input.election_date.trim() : "";
    if (!isIsoDate(election_date)) errors.election_date = "تاريخ غير صالح";
    else patch.election_date = election_date;
  }
  if ("status" in input) {
    const status = input.status as CycleStatusInput;
    if (!(CYCLE_STATUSES as readonly string[]).includes(status)) {
      errors.status = "الحالة planned أو active أو closed";
    } else {
      patch.status = status;
    }
  }
  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok(patch);
}

export function validateRegionInput(raw: unknown): Result<{ name: string }> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 64) {
    return fail(400, { name: "اسم المنطقة بين 2 و64 حرفاً" });
  }
  return ok({ name });
}

export function validateTeamInput(raw: unknown): Result<{ name: string; region_id: string | null }> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;

  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 64) errors.name = "اسم الفريق بين 2 و64 حرفاً";

  let region_id: string | null = null;
  if (input.region_id !== undefined && input.region_id !== null && input.region_id !== "") {
    if (typeof input.region_id !== "string") errors.region_id = "منطقة غير صالحة";
    else region_id = input.region_id;
  }

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok({ name, region_id });
}
