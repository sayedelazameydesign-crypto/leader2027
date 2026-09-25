import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import NotesForm from "@/components/field/NotesForm";
import StatusForm from "@/components/field/StatusForm";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { repos, user } = await requirePageUser();
  const report = repos.reports.getById(id);
  if (!report) notFound();

  const canEditNotes =
    can(user, "reports:update_notes", { reported_by: report.reported_by });
  const canChangeStatus = can(user, "reports:update_status");

  return (
    <>
      <section className="hero">
        <h1>{report.activity}</h1>
        <p>
          {report.report_date} — {repos.regions.getById(report.region_id)?.name} —{" "}
          {repos.teams.getById(report.team_id)?.name} — أُنشئ بواسطة:{" "}
          {repos.users.getById(report.reported_by)?.name ?? report.reported_by}
        </p>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>التفاصيل</h2>
          <Link href="/field/reports">→ العودة للتقارير</Link>
        </div>
        <ul className="detail-list">
          <li>المُتصل بهم: <strong>{report.people_contacted}</strong></li>
          <li>متطوعون حاضرون: <strong>{report.volunteers_present}</strong></li>
          <li>
            الحالة: <span className="chip chip-neutral">{report.status}</span>
          </li>
        </ul>

        {canChangeStatus ? (
          <StatusForm reportId={report.id} current={report.status} />
        ) : null}

        {canEditNotes ? (
          <NotesForm reportId={report.id} notes={report.notes} />
        ) : (
          <p className="muted">
            الملاحظات: {report.notes || "—"} (التعديل لصاحب التقرير أو منسق فأعلى)
          </p>
        )}
      </section>
    </>
  );
}
