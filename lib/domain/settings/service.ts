import type {
  Campaign,
  ElectionCycle,
  Region,
  Repos,
  Team,
} from "@/lib/repositories/interfaces";
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
  validateCampaignPatch,
  validateCycleInput,
  validateCyclePatch,
  validateRegionInput,
  validateTeamInput,
} from "@/lib/validation/settings";

export function getSettings(
  actor: Actor,
  repos: Repos,
): Result<{
  campaign: Campaign | null;
  cycles: ElectionCycle[];
  regions: Region[];
  teams: Team[];
}> {
  if (!can(actor, "settings:manage")) return forbidden();
  return ok({
    campaign: repos.campaign.get(),
    cycles: repos.cycles.list(),
    regions: repos.regions.list(),
    teams: repos.teams.list(),
  });
}

export function updateCampaign(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<Campaign> {
  if (!can(actor, "settings:manage")) return forbidden();
  const input = validateCampaignPatch(raw);
  if (!input.ok) return input;
  const updated = repos.campaign.update(input.value);
  if (!updated) return notFound("campaign");
  recordAudit(repos, actor, "campaign.update", "campaign", updated.id, {
    name: updated.name,
  });
  return ok(updated);
}

export function createCycle(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<ElectionCycle> {
  if (!can(actor, "settings:manage")) return forbidden();
  const input = validateCycleInput(raw);
  if (!input.ok) return input;
  const now = new Date().toISOString();
  const cycle = repos.cycles.create({ ...input.value, created_at: now, updated_at: now });
  recordAudit(repos, actor, "cycle.create", "election_cycle", cycle.id, {
    election_date: cycle.election_date,
  });
  return ok(cycle);
}

export function updateCycle(
  actor: Actor,
  id: string,
  raw: unknown,
  repos: Repos,
): Result<ElectionCycle> {
  if (!can(actor, "settings:manage")) return forbidden();
  const patch = validateCyclePatch(raw);
  if (!patch.ok) return patch;
  if (Object.keys(patch.value).length === 0) return fail(400, { _form: "لا تغييرات" });
  const updated = repos.cycles.update(id, patch.value);
  if (!updated) return notFound("cycle_id");
  recordAudit(repos, actor, "cycle.update", "election_cycle", id);
  return ok(updated);
}

export function createRegion(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<Region> {
  if (!can(actor, "settings:manage")) return forbidden();
  const input = validateRegionInput(raw);
  if (!input.ok) return input;
  const region = repos.regions.create(input.value);
  recordAudit(repos, actor, "region.create", "region", region.id, { name: region.name });
  return ok(region);
}

export function createTeam(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<Team> {
  if (!can(actor, "settings:manage")) return forbidden();
  const input = validateTeamInput(raw);
  if (!input.ok) return input;
  if (input.value.region_id && !repos.regions.getById(input.value.region_id)) {
    return fail(400, { region_id: "منطقة غير معروفة" });
  }
  const team = repos.teams.create(input.value);
  recordAudit(repos, actor, "team.create", "team", team.id, { name: team.name });
  return ok(team);
}
