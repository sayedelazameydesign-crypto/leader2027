import { fail, ok, type Result } from "./result";
import { rejectPoliticalFields } from "./sensitive";
import { isRole } from "@/lib/authorization/roles";
import type { Role } from "@/lib/authorization/roles";

export type UserInput = {
  name: string;
  email: string;
  password: string;
  role: Role;
  team_id: string | null;
  region_id: string | null;
};

export type UserPatch = Partial<{
  name: string;
  role: Role;
  team_id: string | null;
  region_id: string | null;
}>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function political(raw: Record<string, unknown>): Result<never> | null {
  const errors = rejectPoliticalFields(raw);
  return Object.keys(errors).length > 0 ? fail(400, errors) : null;
}

export function validateUserInput(raw: unknown): Result<UserInput> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;

  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) errors.name = "الاسم بين 2 و80 حرفاً";

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 160) errors.email = "بريد غير صالح";

  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 8 || password.length > 200) {
    errors.password = "كلمة المرور 8 أحرف فأكثر";
  }

  if (!isRole(input.role)) {
    return fail(400, { ...errors, role: "دور غير معروف" });
  }
  const role: Role = input.role;

  let team_id: string | null = null;
  if (input.team_id !== undefined && input.team_id !== null && input.team_id !== "") {
    if (typeof input.team_id !== "string") errors.team_id = "فريق غير صالح";
    else team_id = input.team_id;
  }

  let region_id: string | null = null;
  if (input.region_id !== undefined && input.region_id !== null && input.region_id !== "") {
    if (typeof input.region_id !== "string") errors.region_id = "منطقة غير صالحة";
    else region_id = input.region_id;
  }

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok({ name, email, password, role, team_id, region_id });
}

export function validateUserPatch(raw: unknown): Result<UserPatch> {
  if (typeof raw !== "object" || raw === null) return fail(400, { _form: "بيانات غير صالحة" });
  const input = raw as Record<string, unknown>;
  const blocked = political(input);
  if (blocked) return blocked;

  const errors: Record<string, string> = {};
  const patch: UserPatch = {};
  const allowed = ["name", "role", "team_id", "region_id"];

  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      errors[key] = "حقل غير قابل للتعديل في v1 (المسموح: name وrole وteam_id وregion_id)";
    }
  }

  if ("name" in input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 2 || name.length > 80) errors.name = "الاسم بين 2 و80 حرفاً";
    else patch.name = name;
  }
  if ("role" in input) {
    if (!isRole(input.role)) errors.role = "دور غير معروف";
    else patch.role = input.role;
  }
  if ("team_id" in input) {
    patch.team_id = typeof input.team_id === "string" && input.team_id ? input.team_id : null;
  }
  if ("region_id" in input) {
    patch.region_id = typeof input.region_id === "string" && input.region_id ? input.region_id : null;
  }

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok(patch);
}
