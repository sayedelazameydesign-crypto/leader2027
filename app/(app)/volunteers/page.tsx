import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listVolunteers } from "@/lib/domain/volunteers/service";

export default async function VolunteersPage() {
  const { repos, user } = await requirePageUser();
  const volunteers = listVolunteers(user, repos);

  return (
    <>
      <section className="hero">
        <h1>المتطوعون</h1>
        <p>بيانات المتطوعين التشغيلية — مرتبطة بسجل الشخص الموحد.</p>
      </section>

      <section className="dash">
        <table className="table">
          <thead>
            <tr>
              <th>الشخص</th>
              <th>الفريق</th>
              <th>الحالة</th>
              <th>تاريخ الالتحاق</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {volunteers.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link href={`/people/${v.person_id}`}>
                    {repos.people.getById(v.person_id)?.full_name ?? v.person_id}
                  </Link>
                </td>
                <td>{repos.teams.getById(v.team_id)?.name ?? v.team_id}</td>
                <td>
                  <span className={v.status === "active" ? "chip chip-ok" : "chip chip-neutral"}>
                    {v.status === "active" ? "نشط" : "غير نشط"}
                  </span>
                </td>
                <td>{v.joined_at.slice(0, 10)}</td>
                <td>
                  <Link href={`/volunteers/${v.id}`}>التفاصيل</Link>
                </td>
              </tr>
            ))}
            {volunteers.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  لا متطوعون بعد
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
