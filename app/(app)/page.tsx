import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { getKpis } from "@/lib/domain/dashboard";
import { listReports } from "@/lib/domain/field/service";
import KpiCards from "@/components/dashboard/KpiCards";

export default async function DashboardPage() {
  const { repos, user } = await requirePageUser();
  const kpis = getKpis(user, repos);
  const recent = listReports(user, repos)
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);
  const regionName = (id: string) => repos.regions.getById(id)?.name ?? id;
  const teamName = (id: string) => repos.teams.getById(id)?.name ?? id;

  return (
    <>
      <section className="hero">
        <h1>لوحة القيادة</h1>
        <p>مؤشرات الحملة التشغيلية — محسوبة من النشاط المخزَّن فعلياً.</p>
      </section>

      {kpis.ok ? <KpiCards kpis={kpis.value} /> : null}

      <section className="dash">
        <div className="dash-head">
          <h2>أحدث التقارير الميدانية</h2>
          <Link className="btn btn-primary" href="/field/reports/new">
            تقرير جديد
          </Link>
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
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/field/reports/${r.id}`}>{r.report_date}</Link>
                </td>
                <td>{r.activity}</td>
                <td>{regionName(r.region_id)}</td>
                <td>{teamName(r.team_id)}</td>
                <td>{r.people_contacted}</td>
                <td>
                  <span className="chip chip-neutral">{r.status}</span>
                </td>
              </tr>
            ))}
            {recent.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
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
