import { fail, ok, type Result } from "@/lib/validation/result";
import { rejectPoliticalFields } from "@/lib/validation/sensitive";

export type VolunteerStatus = "active" | "inactive";

export type Volunteer = {
  id: string;
  person_id: string;
  team_id: string;
  status: VolunteerStatus;
  joined_at: string;
  created_at: string;
  updated_at: string;
};

export type VolunteerInput = {
  person_id: string;
  team_id: string;
  status: VolunteerStatus;
};

const STATUSES: VolunteerStatus[] = ["active", "inactive"];

export function validateVolunteerInput(raw: unknown): Result<VolunteerInput> {
  if (typeof raw !== "object" || raw === null) {
    return fail(400, { _form: "بيانات غير صالحة" });
  }
  const input = raw as Record<string, unknown>;
  const political = rejectPoliticalFields(input);
  if (Object.keys(political).length > 0) return fail(400, political);

  const errors: Record<string, string> = {};
  const person_id = typeof input.person_id === "string" ? input.person_id.trim() : "";
  if (!person_id) errors.person_id = "person_id مطلوب";

  const team_id = typeof input.team_id === "string" ? input.team_id.trim() : "";
  if (!team_id) errors.team_id = "team_id مطلوب";

  const status = (input.status ?? "active") as VolunteerStatus;
  if (!STATUSES.includes(status)) errors.status = "الحالة active أو inactive";

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok({ person_id, team_id, status });
}

export function validateVolunteerPatch(raw: unknown): Result<Partial<VolunteerInput>> {
  if (typeof raw !== "object" || raw === null) {
    return fail(400, { _form: "بيانات غير صالحة" });
  }
  const input = raw as Record<string, unknown>;
  const political = rejectPoliticalFields(input);
  if (Object.keys(political).length > 0) return fail(400, political);

  const errors: Record<string, string> = {};
  const patch: Partial<VolunteerInput> = {};
  if ("status" in input) {
    const status = input.status as VolunteerStatus;
    if (!STATUSES.includes(status)) errors.status = "الحالة active أو inactive";
    else patch.status = status;
  }
  if ("team_id" in input) {
    if (typeof input.team_id !== "string" || !input.team_id.trim()) {
      errors.team_id = "team_id غير صالح";
    } else {
      patch.team_id = input.team_id.trim();
    }
  }
  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok(patch);
}
