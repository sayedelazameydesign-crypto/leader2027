import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import ReportForm from "@/components/field/ReportForm";

export default async function NewReportPage() {
  const { repos, user } = await requirePageUser();
  if (!can(user, "reports:create")) {
    return (
      <section className="dash">
        <h1>تقرير ميداني جديد</h1>
        <p className="err">دورك الحالي لا يسمح بإنشاء تقارير (عقد المنتج §4).</p>
        <Link href="/field/reports">→ العودة للتقارير</Link>
      </section>
    );
  }

  return (
    <>
      <section className="hero">
        <h1>تقرير ميداني جديد</h1>
        <p>سُجِّل المنطقة والفريق والنشاط — المرجعيات تُتحقق من الصحة عند الحفظ.</p>
      </section>
      <section className="dash">
        <ReportForm
          regions={repos.regions.list().map((r) => ({ id: r.id, name: r.name }))}
          teams={repos.teams.list().map((t) => ({ id: t.id, name: t.name }))}
        />
      </section>
    </>
  );
}
