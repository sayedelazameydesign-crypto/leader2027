"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["submitted", "under_review", "closed"] as const;

export default function StatusForm({
  reportId,
  current,
}: {
  reportId: string;
  current: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (status === current) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/field/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.errors?._auth ?? "تعذّر تغيير الحالة");
    }
  }

  return (
    <div className="form-row">
      <label>
        الحالة (لمنسق فأعلى)
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <button className="btn" onClick={save} disabled={busy || status === current}>
        {busy ? "جارٍ التحديث…" : "تغيير الحالة"}
      </button>
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}
