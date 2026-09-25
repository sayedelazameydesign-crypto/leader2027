"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NotesForm({
  reportId,
  notes,
}: {
  reportId: string;
  notes: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(notes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/field/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: value }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.errors?._auth ?? data?.errors?.notes ?? "تعذّر الحفظ");
    }
  }

  return (
    <form className="form-grid" onSubmit={save}>
      <label>
        الملاحظات
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} />
        {error ? <span className="err">{error}</span> : null}
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الحفظ…" : "حفظ الملاحظات"}
      </button>
      {saved ? <span className="chip chip-ok">حُفظت الملاحظات</span> : null}
    </form>
  );
}
