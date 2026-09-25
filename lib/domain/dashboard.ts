import type { Repos } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/authorization/policy";
import { can } from "@/lib/authorization/policy";
import { forbidden, ok, type Result } from "@/lib/validation/result";
import { computeKpis, type Kpis } from "./stats";

/** مؤشرات القيادة — محسوبة من النشاط المخزَّن فقط (لا بيانات تجريبية). */
export function getKpis(actor: Actor, repos: Repos): Result<Kpis> {
  if (!can(actor, "dashboard:view")) return forbidden();
  return ok(
    computeKpis({
      peopleCount: repos.people.list().length,
      volunteers: repos.volunteers.list(),
      reports: repos.reports.list(),
    }),
  );
}
