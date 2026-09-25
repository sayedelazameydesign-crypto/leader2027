import type { Repos } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/authorization/policy";
import { can } from "@/lib/authorization/policy";
import { recordAudit } from "@/lib/audit/audit";
import {
  fail,
  forbidden,
  notFound,
  ok,
  type Result,
} from "@/lib/validation/result";
import {
  validatePersonInput,
  validatePersonPatch,
  type Person,
} from "./person";

export function createPerson(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<Person> {
  if (!can(actor, "people:create")) return forbidden();
  const input = validatePersonInput(raw);
  if (!input.ok) return input;
  if (input.value.region_id && !repos.regions.getById(input.value.region_id)) {
    return fail(400, { region_id: "منطقة غير معروفة" });
  }
  const now = new Date().toISOString();
  const person = repos.people.create({
    ...input.value,
    created_at: now,
    updated_at: now,
  });
  recordAudit(repos, actor, "person.create", "person", person.id);
  return ok(person);
}

export function updatePerson(
  actor: Actor,
  id: string,
  raw: unknown,
  repos: Repos,
): Result<Person> {
  if (!can(actor, "people:update")) return forbidden();
  const patch = validatePersonPatch(raw);
  if (!patch.ok) return patch;
  if (patch.value.region_id && !repos.regions.getById(patch.value.region_id)) {
    return fail(400, { region_id: "منطقة غير معروفة" });
  }
  const updated = repos.people.update(id, patch.value);
  if (!updated) return notFound("person_id");
  recordAudit(repos, actor, "person.update", "person", id);
  return ok(updated);
}

export function listPeople(actor: Actor, repos: Repos): Person[] {
  return can(actor, "people:view") ? repos.people.list() : [];
}

export function getPerson(
  actor: Actor,
  id: string,
  repos: Repos,
): Result<Person> {
  if (!can(actor, "people:view")) return forbidden();
  const person = repos.people.getById(id);
  if (!person) return notFound("person_id");
  return ok(person);
}
