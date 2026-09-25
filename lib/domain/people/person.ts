import { fail, ok, type Result } from "@/lib/validation/result";
import { rejectPoliticalFields } from "@/lib/validation/sensitive";

export type Person = {
  id: string;
  full_name: string;
  phone: string | null;
  region_id: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type PersonInput = {
  full_name: string;
  phone: string | null;
  region_id: string | null;
  source: string;
};

const PHONE_RE = /^\+?[0-9][0-9 \-()]{5,22}$/;

export function validatePersonInput(raw: unknown): Result<PersonInput> {
  if (typeof raw !== "object" || raw === null) {
    return fail(400, { _form: "بيانات غير صالحة" });
  }
  const input = raw as Record<string, unknown>;
  const political = rejectPoliticalFields(input);
  if (Object.keys(political).length > 0) return fail(400, political);

  const errors: Record<string, string> = {};
  const full_name = typeof input.full_name === "string" ? input.full_name.trim() : "";
  if (full_name.length < 3 || full_name.length > 120) {
    errors.full_name = "الاسم بين 3 و120 حرفاً";
  }

  let phone: string | null = null;
  if (input.phone !== undefined && input.phone !== null && input.phone !== "") {
    if (typeof input.phone !== "string" || !PHONE_RE.test(input.phone.trim())) {
      errors.phone = "رقم هاتف غير صالح";
    } else {
      phone = input.phone.trim();
    }
  }

  let region_id: string | null = null;
  if (input.region_id !== undefined && input.region_id !== null && input.region_id !== "") {
    if (typeof input.region_id !== "string") {
      errors.region_id = "منطقة غير صالحة";
    } else {
      region_id = input.region_id;
    }
  }

  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (source.length < 2 || source.length > 64) {
    errors.source = "مصدر السجل بين 2 و64 حرفاً (وعي بالمصدر إلزامي)";
  }

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok({ full_name, phone, region_id, source });
}

export function validatePersonPatch(raw: unknown): Result<Partial<PersonInput>> {
  if (typeof raw !== "object" || raw === null) {
    return fail(400, { _form: "بيانات غير صالحة" });
  }
  const input = raw as Record<string, unknown>;
  const political = rejectPoliticalFields(input);
  if (Object.keys(political).length > 0) return fail(400, political);

  const merged: Record<string, unknown> = {
    full_name: "placeholder-name",
    source: "placeholder-source",
    ...input,
  };
  const result = validatePersonInput(merged);
  if (!result.ok) return result;
  const patch: Partial<PersonInput> = {};
  if ("full_name" in input) patch.full_name = result.value.full_name;
  if ("phone" in input) patch.phone = result.value.phone;
  if ("region_id" in input) patch.region_id = result.value.region_id;
  if ("source" in input) patch.source = result.value.source;
  return ok(patch);
}
