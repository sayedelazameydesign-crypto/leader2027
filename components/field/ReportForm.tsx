"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };

export default function ReportForm({
  regions,
  teams,
}: {
  regions: Option[];
  teams: Option[];
}) {
  const router = useRouter();
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [activity, setActivity] = useState("");
  const [peopleContacted, setPeopleContacted] = useState("0");
  const [volunteersPresent, setVolunteersPresent] = useState("0");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const res = await fetch("/api/field/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        region_id: regionId,
        team_id: teamId,
        report_date: reportDate,
        activity,
        people_contacted: Number(peopleContacted),
        volunteers_present: Number(volunteersPresent),
        notes,
      }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/field/reports");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setErrors(data?.errors ?? { _form: "تعذّر الحفظ" });
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        المنطقة
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {errors.region_id ? <span className="err">{errors.region_id}</span> : null}
      </label>
      <label>
        الفريق
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {errors.team_id ? <span className="err">{errors.team_id}</span> : null}
      </label>
      <label>
        التاريخ
        <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} required />
        {errors.report_date ? <span className="err">{errors.report_date}</span> : null}
      </label>
      <label>
        النشاط
        <input value={activity} onChange={(e) => setActivity(e.target.value)} required />
        {errors.activity ? <span className="err">{errors.activity}</span> : null}
      </label>
      <label>
        عدد المُتصل بهم
        <input
          type="number"
          min={0}
          value={peopleContacted}
          onChange={(e) => setPeopleContacted(e.target.value)}
        />
        {errors.people_contacted ? <span className="err">{errors.people_contacted}</span> : null}
      </label>
      <label>
        متطوعون حاضرون
        <input
          type="number"
          min={0}
          value={volunteersPresent}
          onChange={(e) => setVolunteersPresent(e.target.value)}
        />
        {errors.volunteers_present ? <span className="err">{errors.volunteers_present}</span> : null}
      </label>
      <label>
        ملاحظات
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        {errors.notes ? <span className="err">{errors.notes}</span> : null}
      </label>
      {errors._form ? <p className="err">{errors._form}</p> : null}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الإرسال…" : "Submit Report — حفظ التقرير"}
      </button>
    </form>
  );
}
