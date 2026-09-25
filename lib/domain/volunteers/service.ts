import type { Repos } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/authorization/policy";
import { can } from "@/lib/authorization/policy";
import { recordAudit } from "@/lib/audit/audit";
import {
  conflict,
  fail,
  forbidden,
  notFound,
  ok,
  type Result,
} from "@/lib/validation/result";
import {
  validateVolunteerInput,
  validateVolunteerPatch,
  type Volunteer,
} from "./volunteer";

export function createVolunteer(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<Volunteer> {
  if (!can(actor, "volunteers:create")) return forbidden();
  const input = validateVolunteerInput(raw);
  if (!input.ok) return input;
  if (!repos.people.getById(input.value.person_id)) {
    return fail(400, { person_id: "شخص غير موجود" });
  }
  if (!repos.teams.getById(input.value.team_id)) {
    return fail(400, { team_id: "فريق غير موجود" });
  }
  if (repos.volunteers.getActiveByPerson(input.value.person_id)) {
    return conflict({ person_id: "لدى هذا الشخص متطوع نشط بالفعل" });
  }
  const now = new Date().toISOString();
  const volunteer = repos.volunteers.create({
    ...input.value,
    joined_at: now,
    created_at: now,
    updated_at: now,
  });
  recordAudit(repos, actor, "volunteer.create", "volunteer", volunteer.id, {
    person_id: volunteer.person_id,
    team_id: volunteer.team_id,
  });
  return ok(volunteer);
}

export function updateVolunteer(
  actor: Actor,
  id: string,
  raw: unknown,
  repos: Repos,
): Result<Volunteer> {
  if (!can(actor, "volunteers:update")) return forbidden();
  const patch = validateVolunteerPatch(raw);
  if (!patch.ok) return patch;
  if (patch.value.team_id && !repos.teams.getById(patch.value.team_id)) {
    return fail(400, { team_id: "فريق غير موجود" });
  }
  const updated = repos.volunteers.update(id, patch.value);
  if (!updated) return notFound("volunteer_id");
  recordAudit(repos, actor, "volunteer.update", "volunteer", id);
  return ok(updated);
}

export function listVolunteers(
  actor: Actor,
  repos: Repos,
  filter?: { team_id?: string; person_id?: string },
): Volunteer[] {
  return can(actor, "volunteers:view") ? repos.volunteers.list(filter) : [];
}

export function getVolunteer(
  actor: Actor,
  id: string,
  repos: Repos,
): Result<Volunteer> {
  if (!can(actor, "volunteers:view")) return forbidden();
  const volunteer = repos.volunteers.getById(id);
  if (!volunteer) return notFound("volunteer_id");
  return ok(volunteer);
}
