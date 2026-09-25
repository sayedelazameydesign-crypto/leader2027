import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import { listPeople } from "@/lib/domain/people/service";
import PersonForm from "@/components/people/PersonForm";

export default async function PeoplePage() {
  const { repos, user } = await requirePageUser();
  const people = listPeople(user, repos);
  const regionName = (id: string | null) =>
    id ? repos.regions.getById(id)?.name ?? id : "—";

  return (
    <>
      <section className="hero">
        <h1>الأشخاص</h1>
        <p>دليل الأشخاص — سجلات واعية بالمصدر، بلا أي تفضيلات سياسية (عقد المنتج §5).</p>
      </section>

      <section className="dash">
        <table className="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الهاتف</th>
              <th>المنطقة</th>
              <th>المصدر</th>
              <th>متطوع؟</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const active = repos.volunteers.getActiveByPerson(p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/people/${p.id}`}>{p.full_name}</Link>
                  </td>
                  <td>{p.phone ?? "—"}</td>
                  <td>{regionName(p.region_id)}</td>
                  <td>
                    <span className="chip chip-neutral">{p.source}</span>
                  </td>
                  <td>
                    {active ? (
                      <span className="chip chip-ok">نشط</span>
                    ) : (
                      <span className="muted">لا</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/people/${p.id}`}>
                      {active || !can(user, "volunteers:create")
                        ? "التفاصيل"
                        : "تسجيل كمتطوع"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {can(user, "people:create") ? (
        <section className="dash">
          <div className="dash-head">
            <h2>إضافة شخص</h2>
          </div>
          <PersonForm
            regions={repos.regions.list().map((r) => ({ id: r.id, name: r.name }))}
          />
        </section>
      ) : null}
    </>
  );
}
