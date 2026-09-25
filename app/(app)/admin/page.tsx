import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import { getSettings } from "@/lib/domain/settings/service";
import {
  CampaignForm,
  CycleForm,
  CycleStatusForm,
  RegionForm,
  TeamForm,
} from "@/components/admin/SettingsForms";

export default async function AdminPage() {
  const { repos, user } = await requirePageUser();
  const settings = getSettings(user, repos);
  if (!settings.ok) {
    return (
      <section className="dash">
        <h1>الإدارة</h1>
        <p className="err">دورك الحالي لا يسمح بإدارة الحملة (settings:manage = منسق إدارة فأعلى).</p>
        <Link href="/">→ لوحة القيادة</Link>
      </section>
    );
  }
  const { campaign, cycles, regions, teams } = settings.value;
  const regionName = (id: string | null) =>
    id ? regions.find((r) => r.id === id)?.name ?? id : "—";

  return (
    <>
      <section className="hero">
        <h1>الإدارة — نواة الحملة</h1>
        <p>الحملة والدورات الانتخابية والمناطق والفرق — كل تغيير مسجَّل في التدقيق.</p>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>الحملة</h2>
          <Link href="/admin/users">إدارة المستخدمين →</Link>
        </div>
        {campaign ? (
          <CampaignForm name={campaign.name} />
        ) : (
          <p className="muted">لا سجل حملة</p>
        )}
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>الدورات الانتخابية ({cycles.length})</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الاستحقاق</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.election_date}</td>
                <td>
                  <span className="chip chip-neutral">{c.status}</span>
                </td>
                <td>
                  <CycleStatusForm cycleId={c.id} current={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <CycleForm />
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>المناطق ({regions.length})</h2>
        </div>
        <ul className="detail-list">
          {regions.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
        <RegionForm />
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>الفرق ({teams.length})</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>المنطقة</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{regionName(t.region_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <TeamForm regions={regions.map((r) => ({ id: r.id, name: r.name }))} />
      </section>
    </>
  );
}
