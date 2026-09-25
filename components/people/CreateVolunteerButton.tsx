"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TeamOption = { id: string; name: string };

export default function CreateVolunteerButton({
  personId,
  teams,
}: {
  personId: string;
  teams: TeamOption[];
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/volunteers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ person_id: personId, team_id: teamId }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.errors?._auth ?? data?.errors?.team_id ?? data?.errors?.person_id ?? "تعذّر الإنشاء");
    }
  }

  return (
    <div className="form-row">
      <label>
        الفريق
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-primary" onClick={create} disabled={busy || !teamId}>
        {busy ? "جارٍ التسجيل…" : "Create Volunteer — تسجيل كمتطوع"}
      </button>
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}
