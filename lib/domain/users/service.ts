import type { Repos, User } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/authorization/policy";
import { can } from "@/lib/authorization/policy";
import { recordAudit } from "@/lib/audit/audit";
import { hashPassword } from "@/lib/auth/password";
import { publicUser } from "@/lib/auth/request";
import {
  conflict,
  fail,
  forbidden,
  notFound,
  ok,
  type Result,
} from "@/lib/validation/result";
import { validateUserInput, validateUserPatch } from "@/lib/validation/users";

export type PublicUser = Omit<User, "password_hash">;

export function listUsers(actor: Actor, repos: Repos): Result<PublicUser[]> {
  if (!can(actor, "users:manage")) return forbidden();
  return ok(repos.users.list().map(publicUser));
}

export function createUser(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<PublicUser> {
  if (!can(actor, "users:manage")) return forbidden();
  const input = validateUserInput(raw);
  if (!input.ok) return input;
  if (repos.users.getByEmail(input.value.email)) {
    return conflict({ email: "بريد مستخدم بالفعل" });
  }
  if (input.value.team_id && !repos.teams.getById(input.value.team_id)) {
    return fail(400, { team_id: "فريق غير موجود" });
  }
  if (input.value.region_id && !repos.regions.getById(input.value.region_id)) {
    return fail(400, { region_id: "منطقة غير معروفة" });
  }
  const now = new Date().toISOString();
  const user = repos.users.create({
    name: input.value.name,
    email: input.value.email,
    password_hash: hashPassword(input.value.password),
    role: input.value.role,
    team_id: input.value.team_id,
    region_id: input.value.region_id,
    session_epoch: 0,
    created_at: now,
  });
  recordAudit(repos, actor, "user.create", "user", user.id, { role: user.role });
  return ok(publicUser(user));
}

export function updateUser(
  actor: Actor,
  id: string,
  raw: unknown,
  repos: Repos,
): Result<PublicUser> {
  if (!can(actor, "users:manage")) return forbidden();
  const patch = validateUserPatch(raw);
  if (!patch.ok) return patch;
  const existing = repos.users.getById(id);
  if (!existing) return notFound("user_id");
  if (patch.value.team_id && !repos.teams.getById(patch.value.team_id)) {
    return fail(400, { team_id: "فريق غير موجود" });
  }
  if (patch.value.region_id && !repos.regions.getById(patch.value.region_id)) {
    return fail(400, { region_id: "منطقة غير معروفة" });
  }

  // VS3 — تقوية الجلسات: تغيير الدور يبطِل كل الجلسات السابقة (session_epoch += 1)
  const roleChanged = patch.value.role !== undefined && patch.value.role !== existing.role;
  const updated = repos.users.update(id, {
    ...patch.value,
    session_epoch: roleChanged ? existing.session_epoch + 1 : existing.session_epoch,
  });
  if (!updated) return notFound("user_id");
  recordAudit(repos, actor, "user.update", "user", id, {
    role_changed: roleChanged ? 1 : 0,
    ...(roleChanged ? { from_role: existing.role, to_role: patch.value.role! } : {}),
  });
  return ok(publicUser(updated));
}
