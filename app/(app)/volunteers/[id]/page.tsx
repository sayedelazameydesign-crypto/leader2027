import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import ToggleStatusButton from "@/components/volunteers/ToggleStatusButton";

export default async function VolunteerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { repos, user } = await requirePageUser();
  const volunteer = repos.volunteers.getById(id);
  if (!volunteer) notFound();

  const person = repos.people.getById(volunteer.person_id);
  const team = repos.teams.getById(volunteer.team_id);

  return (
    <>
      <section className="hero">
        <h1>متطوع: {person?.full_name ?? volunteer.person_id}</h1>
        <p>
          الفريق: {team?.name ?? volunteer.team_id} — الالتحاق:{" "}
          {volunteer.joined_at.slice(0, 10)}
        </p>
      </section>

      <section className="dash">
        <div className="dash-head">
          <h2>الحالة التشغيلية</h2>
          <Link href="/volunteers">→ العودة للقائمة</Link>
        </div>
        <p>
          الحالة:{" "}
          <span className={volunteer.status === "active" ? "chip chip-ok" : "chip chip-neutral"}>
            {volunteer.status === "active" ? "نشط" : "غير نشط"}
          </span>
        </p>
        {can(user, "volunteers:update") ? (
          <ToggleStatusButton
            volunteerId={volunteer.id}
            current={volunteer.status}
          />
        ) : (
          <p className="muted">تعديل الحالة يتطلب صلاحية منسق فأعلى.</p>
        )}
        {person ? (
          <p>
            سجل الشخص: <Link href={`/people/${person.id}`}>{person.full_name}</Link>
          </p>
        ) : null}
      </section>
    </>
  );
}
