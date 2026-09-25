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
  isFieldReportStatus,
  validateReportInput,
  type FieldReport,
} from "./field-report";

export function createReport(
  actor: Actor,
  raw: unknown,
  repos: Repos,
): Result<FieldReport> {
  if (!can(actor, "reports:create")) return forbidden();
  const input = validateReportInput(raw);
  if (!input.ok) return input;
  if (!repos.regions.getById(input.value.region_id)) {
    return fail(400, { region_id: "منطقة غير معروفة" });
  }
  if (!repos.teams.getById(input.value.team_id)) {
    return fail(400, { team_id: "فريق غير موجود" });
  }
  const now = new Date().toISOString();
  const report = repos.reports.create({
    ...input.value,
    reported_by: actor.id,
    status: "submitted",
    created_at: now,
    updated_at: now,
  });
  recordAudit(repos, actor, "report.create", "field_report", report.id, {
    region_id: report.region_id,
    team_id: report.team_id,
    people_contacted: report.people_contacted,
  });
  return ok(report);
}

/**
 * PATCH محدود عمداً: الملاحظات (المُنشئ أو Coordinator+) والحالة (Coordinator+ فقط).
 * أي حقل آخر في الطلب مرفوض — التقرير سجل ميداني لا يُعاد كتابته.
 */
export function updateReport(
  actor: Actor,
  id: string,
  raw: unknown,
  repos: Repos,
): Result<FieldReport> {
  const existing = repos.reports.getById(id);
  if (!existing) return notFound("report_id");
  if (typeof raw !== "object" || raw === null) {
    return fail(400, { _form: "بيانات غير صالحة" });
  }
  const input = raw as Record<string, unknown>;
  const allowed = ["notes", "status"];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      return fail(400, { [key]: "حقل غير قابل للتعديل (المسموح: notes وstatus)" });
    }
  }

  const patch: { notes?: string; status?: FieldReport["status"] } = {};
  if ("status" in input) {
    if (!isFieldReportStatus(input.status)) {
      return fail(400, { status: "حالة غير صالحة" });
    }
    if (input.status !== existing.status) {
      if (!can(actor, "reports:update_status")) return forbidden();
      patch.status = input.status;
    }
  }
  if ("notes" in input) {
    if (typeof input.notes !== "string" || input.notes.length > 2000) {
      return fail(400, { notes: "الملاحظات حتى 2000 حرفاً" });
    }
    if (!can(actor, "reports:update_notes", { reported_by: existing.reported_by })) {
      return forbidden();
    }
    patch.notes = input.notes;
  }

  if (Object.keys(patch).length === 0) {
    return fail(400, { _form: "لا تغييرات" });
  }
  const updated = repos.reports.update(id, patch);
  if (!updated) return notFound("report_id");
  recordAudit(repos, actor, "report.update", "field_report", id, {
    fields: Object.keys(patch).join(","),
  });
  return ok(updated);
}

export function listReports(
  actor: Actor,
  repos: Repos,
  filter?: { team_id?: string; region_id?: string },
): FieldReport[] {
  return can(actor, "reports:view") ? repos.reports.list(filter) : [];
}

export function getReport(
  actor: Actor,
  id: string,
  repos: Repos,
): Result<FieldReport> {
  if (!can(actor, "reports:view")) return forbidden();
  const report = repos.reports.getById(id);
  if (!report) return notFound("report_id");
  return ok(report);
}
