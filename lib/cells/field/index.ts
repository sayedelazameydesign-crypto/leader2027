/**
 * نواة العمل الميداني — `field`
 *
 * الركن: التقارير الميدانية.
 * تُشبع `field.reports.read` و`field.reports.write`، وتنشر أحداثًا تستهلكها نواة
 * المؤشرات — فلا تعرف هذه النواة أن نواة المؤشرات موجودة أصلًا.
 */
import { defineCell, type Actor } from "@/lib/kernel/types";
import { repos, numberSlot, toDomainActor, ToolFailure } from "@/lib/kernel/bridge";
import { can } from "@/lib/authorization/policy";
import { createReport, getReport, listReports, updateReport } from "@/lib/domain/field/service";
import type { FieldReport } from "@/lib/domain/field/field-report";

export type ReportsReader = {
  list(actor: Actor, filter?: { team_id?: string; region_id?: string }): FieldReport[];
  get(actor: Actor, id: string): FieldReport;
};

export type ReportsWriter = {
  submit(actor: Actor, input: unknown): FieldReport;
  updateNotes(actor: Actor, id: string, notes: string): FieldReport;
  updateStatus(actor: Actor, id: string, status: string): FieldReport;
};

function unwrap<T>(result: { ok: true; value: T } | { ok: false; status: number; errors: Record<string, string> }): T {
  if (result.ok) return result.value;
  const message = Object.values(result.errors).join(" · ") || "فشل غير محدَّد";
  throw new ToolFailure(`domain.${result.status}`, message);
}

const fieldCell = defineCell({
  manifest: {
    id: "field",
    version: "1.0.0",
    title: { ar: "نواة العمل الميداني", en: "Field Nucleus" },
    corner: "التقارير الميدانية",
    summary: {
      ar: "تسجيل التقارير الميدانية وتعديل ملاحظاتها وحالتها، ونشر الأحداث للمؤشرات.",
      en: "Submits field reports and updates notes/status, publishing events for the reporting nucleus.",
    },
    provides: ["field.reports.read", "field.reports.write"],
    requires: ["auth.session", "audit.trail"],
    emits: ["field.report.submitted", "field.report.updated"],
    consumes: [],
    config: [
      {
        key: "max_people_contacted",
        label: { ar: "أقصى عدد مُتصل بهم", en: "Max people contacted" },
        default: 500,
        effect: {
          ar: "سقف تشغيلي لعدد المتصل بهم في التقرير الواحد قبل الرفض (10-5000).",
          en: "Operational ceiling on people contacted per report before refusal (10-5000).",
        },
      },
      {
        key: "require_activity",
        label: { ar: "النشاط إلزامي", en: "Activity required" },
        default: true,
        effect: {
          ar: "عند التمكين يُرفض تقرير بلا وصف نشاط غير فارغ.",
          en: "When enabled, a report with an empty activity description is refused.",
        },
      },
    ],
    tools: [
      {
        name: "field.list_reports",
        label: { ar: "قائمة التقارير", en: "List reports" },
        capability: "field.reports.read",
        risk: "read",
        input: { team_id: "string", region_id: "string" },
        requiresApprovalForAgents: false,
      },
      {
        name: "field.get_report",
        label: { ar: "تقرير واحد", en: "Get report" },
        capability: "field.reports.read",
        risk: "read",
        input: { id: "string" },
        requiresApprovalForAgents: false,
      },
      {
        name: "field.submit_report",
        label: { ar: "تسجيل تقرير", en: "Submit report" },
        capability: "field.reports.write",
        risk: "write",
        input: {
          region_id: "string",
          team_id: "string",
          report_date: "string",
          activity: "string",
          people_contacted: "number",
          volunteers_present: "number",
        },
        requiresApprovalForAgents: true,
      },
      {
        name: "field.update_notes",
        label: { ar: "تعديل ملاحظات", en: "Update notes" },
        capability: "field.reports.write",
        risk: "write",
        input: { id: "string", notes: "string" },
        requiresApprovalForAgents: true,
      },
      {
        name: "field.update_status",
        label: { ar: "تعديل حالة التقرير", en: "Update report status" },
        capability: "field.reports.write",
        risk: "write",
        input: { id: "string", status: "string" },
        requiresApprovalForAgents: true,
      },
    ],
  },

  services: {
    "field.reports.read": {
      list(actor: Actor, filter?: { team_id?: string; region_id?: string }): FieldReport[] {
        const domainActor = toDomainActor(actor);
        if (!can(domainActor, "reports:view")) {
          throw new ToolFailure("forbidden", "لا تملك صلاحية `reports:view`");
        }
        return listReports(domainActor, repos(), filter);
      },
      get(actor: Actor, id: string): FieldReport {
        return unwrap(getReport(toDomainActor(actor), id, repos()));
      },
    } satisfies ReportsReader,

    "field.reports.write": {
      submit(actor: Actor, input: unknown): FieldReport {
        return unwrap(createReport(toDomainActor(actor), input, repos()));
      },
      updateNotes(actor: Actor, id: string, notes: string): FieldReport {
        return unwrap(updateReport(toDomainActor(actor), id, { notes }, repos()));
      },
      updateStatus(actor: Actor, id: string, status: string): FieldReport {
        return unwrap(updateReport(toDomainActor(actor), id, { status }, repos()));
      },
    } satisfies ReportsWriter,
  },

  tools: {
    "field.list_reports": (ctx) => {
      const reader = ctx.require<ReportsReader>("field.reports.read");
      const filter: { team_id?: string; region_id?: string } = {};
      if (ctx.input.team_id) filter.team_id = String(ctx.input.team_id);
      if (ctx.input.region_id) filter.region_id = String(ctx.input.region_id);
      const items = reader.list(ctx.actor, Object.keys(filter).length ? filter : undefined);
      return { count: items.length, items };
    },

    "field.get_report": (ctx) => {
      const reader = ctx.require<ReportsReader>("field.reports.read");
      return reader.get(ctx.actor, String(ctx.input.id ?? ""));
    },

    "field.submit_report": (ctx) => {
      const writer = ctx.require<ReportsWriter>("field.reports.write");
      const input = { ...(ctx.input as Record<string, unknown>) };

      // مَقبض: سقف المتصل بهم — رفض صريح قبل الوصول للخدمة
      const ceiling = numberSlot(ctx.config.max_people_contacted, 500, 10, 5000);
      const contacted = Number(input.people_contacted ?? 0);
      if (Number.isFinite(contacted) && contacted > ceiling) {
        throw new ToolFailure(
          "field.ceiling",
          `عدد المتصل بهم (${contacted}) يتجاوز سقف هذا الركن (${ceiling})`,
        );
      }
      // مَقبض: إلزامية وصف النشاط
      if (ctx.config.require_activity === true && String(input.activity ?? "").trim().length === 0) {
        throw new ToolFailure("field.activity_required", "هذا الركن يشترط وصف نشاط غير فارغ");
      }

      const report = writer.submit(ctx.actor, input);
      ctx.emit("field.report.submitted", {
        report_id: report.id,
        region_id: report.region_id,
        team_id: report.team_id,
        people_contacted: report.people_contacted,
        volunteers_present: report.volunteers_present,
      });
      return report;
    },

    "field.update_notes": (ctx) => {
      const writer = ctx.require<ReportsWriter>("field.reports.write");
      const report = writer.updateNotes(ctx.actor, String(ctx.input.id ?? ""), String(ctx.input.notes ?? ""));
      ctx.emit("field.report.updated", { report_id: report.id, field: "notes" });
      return report;
    },

    "field.update_status": (ctx) => {
      const writer = ctx.require<ReportsWriter>("field.reports.write");
      const report = writer.updateStatus(ctx.actor, String(ctx.input.id ?? ""), String(ctx.input.status ?? ""));
      ctx.emit("field.report.updated", { report_id: report.id, field: "status", status: report.status });
      return report;
    },
  },

  health() {
    try {
      const reports = repos().reports.list();
      const contacted = reports.reduce((sum, r) => sum + r.people_contacted, 0);
      return {
        ok: true,
        detail: `المخزن متاح — ${reports.length} تقريرًا (${contacted} مُتصل بهم)`,
        at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        detail: `تعذّر الوصول للمخزن: ${err instanceof Error ? err.message : String(err)}`,
        at: new Date().toISOString(),
      };
    }
  },
});

export { fieldCell };
