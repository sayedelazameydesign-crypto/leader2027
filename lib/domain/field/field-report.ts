import { fail, ok, type Result } from "@/lib/validation/result";
import { rejectPoliticalFields } from "@/lib/validation/sensitive";

export type FieldReportStatus = "submitted" | "under_review" | "closed";

export type FieldReport = {
  id: string;
  region_id: string;
  team_id: string;
  reported_by: string;
  report_date: string;
  activity: string;
  people_contacted: number;
  volunteers_present: number;
  notes: string;
  status: FieldReportStatus;
  created_at: string;
  updated_at: string;
};

export type FieldReportInput = {
  region_id: string;
  team_id: string;
  report_date: string;
  activity: string;
  people_contacted: number;
  volunteers_present: number;
  notes: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: FieldReportStatus[] = ["submitted", "under_review", "closed"];

function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

function isCount(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

export function validateReportInput(raw: unknown): Result<FieldReportInput> {
  if (typeof raw !== "object" || raw === null) {
    return fail(400, { _form: "بيانات غير صالحة" });
  }
  const input = raw as Record<string, unknown>;
  const political = rejectPoliticalFields(input);
  if (Object.keys(political).length > 0) return fail(400, political);

  const errors: Record<string, string> = {};
  const region_id = typeof input.region_id === "string" ? input.region_id.trim() : "";
  if (!region_id) errors.region_id = "region_id مطلوب";

  const team_id = typeof input.team_id === "string" ? input.team_id.trim() : "";
  if (!team_id) errors.team_id = "team_id مطلوب";

  const report_date = typeof input.report_date === "string" ? input.report_date.trim() : "";
  if (!isIsoDate(report_date)) {
    errors.report_date = "تاريخ التقرير بصيغة YYYY-MM-DD";
  } else {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (report_date > tomorrow) errors.report_date = "تاريخ التقرير في المستقبل";
  }

  const activity = typeof input.activity === "string" ? input.activity.trim() : "";
  if (activity.length < 3 || activity.length > 120) {
    errors.activity = "النشاط بين 3 و120 حرفاً";
  }

  let people_contacted = 0;
  if (!isCount(input.people_contacted ?? 0, 100000)) {
    errors.people_contacted = "عدد المُتصل بهم عداد صحيح بين 0 و100000";
  } else {
    people_contacted = (input.people_contacted ?? 0) as number;
  }

  let volunteers_present = 0;
  if (!isCount(input.volunteers_present ?? 0, 10000)) {
    errors.volunteers_present = "عدد المتطوعين الحاضرين عداد صحيح بين 0 و10000";
  } else {
    volunteers_present = (input.volunteers_present ?? 0) as number;
  }

  let notes = "";
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string" || input.notes.length > 2000) {
      errors.notes = "الملاحظات حتى 2000 حرفاً";
    } else {
      notes = input.notes;
    }
  }

  if (Object.keys(errors).length > 0) return fail(400, errors);
  return ok({
    region_id,
    team_id,
    report_date,
    activity,
    people_contacted,
    volunteers_present,
    notes,
  });
}

export function isFieldReportStatus(value: unknown): value is FieldReportStatus {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}
