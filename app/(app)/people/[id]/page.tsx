import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import CreateVolunteerButton from "@/components/people/CreateVolunteerButton";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { repos, user } = await requirePageUser();
  const person = repos.people.getById(id);
  if (!person) notFound();

  const active = repos.volunteers.getActiveByPerson(person.id);
  const region = person.region_id
    ? repos.regions.getById(person.region_id)?.name
    : null;

  return (
    <>
      <section className="hero">
        <h1>{person.full_name}</h1>
        <p>
          المصدر: {person.source} — المنطقة: {region ?? "—"} — الهاتف:{" "}
          {person.phone ?? "—"}
        </p>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>سجل التطوع</h2>
          <Link href="/people">→ العودة للدليل</Link>
        </div>
        {active ? (
          <p>
            متطوع نشط ضمن{" "}
            <strong>{repos.teams.getById(active.team_id)?.name ?? active.team_id}</strong>{" "}
            منذ {active.joined_at.slice(0, 10)} —{" "}
            <Link href={`/volunteers/${active.id}`}>التفاصيل</Link>
          </p>
        ) : can(user, "volunteers:create") ? (
          <CreateVolunteerButton
            personId={person.id}
            teams={repos.teams.list().map((t) => ({ id: t.id, name: t.name }))}
          />
        ) : (
          <p className="muted">لا يوجد سجل تطوع — والتسجيل يتطلب صلاحية منسق فأعلى.</p>
        )}
      </section>
    </>
  );
}
