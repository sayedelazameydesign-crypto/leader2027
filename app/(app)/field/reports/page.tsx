import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import { listReports } from "@/lib/domain/field/service";

const STATUS_LABEL: Record<string, string> = {
  submitted: "مُقدَّم",
  under_review: "قيد المراجعة",
  closed: "مغلق",
};

export default async function ReportsPage() {
  const { repos, user } = await requirePageUser();
  const reports = listReports(user, repos)
    .slice()
    .sort((a, b) => (a.report_date < b.report_date ? 1 : -1));

  return (
    <>
      <section className="hero">
        <h1>التقارير الميدانية</h1>
        <p>سجل العمل الميداني: منطقة، فريق، نشاط، أعداد — مع تدقيق لكل تغيير.</p>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>كل التقارير ({reports.length})</h2>
          {can(user, "reports:create") ? (
            <Link className="btn btn-primary" href="/field/reports/new">
              تقرير جديد
            </Link>
          ) : null}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>النشاط</th>
              <th>المنطقة</th>
              <th>الفريق</th>
              <th>المُتصل بهم</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>{r.report_date}</td>
                <td>{r.activity}</td>
                <td>{repos.regions.getById(r.region_id)?.name ?? r.region_id}</td>
                <td>{repos.teams.getById(r.team_id)?.name ?? r.team_id}</td>
                <td>{r.people_contacted}</td>
                <td>
                  <span className="chip chip-neutral">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td>
                  <Link href={`/field/reports/${r.id}`}>التفاصيل</Link>
                </td>
              </tr>
            ))}
            {reports.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  لا تقارير بعد
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
