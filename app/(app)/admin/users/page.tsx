import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import { listUsers } from "@/lib/domain/users/service";
import { UserCreateForm, UserRoleForm } from "@/components/admin/UserForms";

export default async function AdminUsersPage() {
  const { repos, user } = await requirePageUser();
  const users = listUsers(user, repos);
  if (!users.ok) {
    return (
      <section className="dash">
        <h1>المستخدمون</h1>
        <p className="err">دورك الحالي لا يسمح بإدارة المستخدمين (users:manage = مدير حملة فأعلى).</p>
        <Link href="/">→ لوحة القيادة</Link>
      </section>
    );
  }

  const teams = repos.teams.list().map((t) => ({ id: t.id, name: t.name }));
  const regions = repos.regions.list().map((r) => ({ id: r.id, name: r.name }));
  const teamName = (id: string | null) =>
    id ? teams.find((t) => t.id === id)?.name ?? id : "—";

  return (
    <>
      <section className="hero">
        <h1>المستخدمون والصلاحيات</h1>
        <p>
          تغيير الدور يُبطل الجلسات القديمة فوراً (session_epoch) — والبريد وكلمة المرور
          غير قابلين للتعديل في v1.
        </p>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>المستخدمون ({users.value.length})</h2>
          <Link href="/admin">→ الإدارة</Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد</th>
              <th>الدور</th>
              <th>الفريق</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.value.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <span className="chip chip-neutral">{u.role}</span>
                </td>
                <td>{teamName(u.team_id)}</td>
                <td>
                  <UserRoleForm
                    userId={u.id}
                    currentRole={u.role}
                    currentTeam={u.team_id}
                    currentRegion={u.region_id}
                    teams={teams}
                    regions={regions}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>إنشاء مستخدم</h2>
        </div>
        <UserCreateForm teams={teams} regions={regions} />
      </section>
    </>
  );
}
