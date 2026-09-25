"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };

function useErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setErrors({});
    setSaved(false);
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      return true;
    }
    const data = await res.json().catch(() => null);
    setErrors(data?.errors ?? { _form: "تعذّر الحفظ" });
    return false;
  }

  return { errors, busy, saved, setErrors, send };
}

export function CampaignForm({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const { errors, busy, saved, send } = useErrors();

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        await send("/api/campaign", "PATCH", { name: value });
      }}
    >
      <label>
        اسم الحملة
        <input value={value} onChange={(e) => setValue(e.target.value)} required />
        {errors.name ? <span className="err">{errors.name}</span> : null}
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الحفظ…" : "حفظ اسم الحملة"}
      </button>
      {saved ? <span className="chip chip-ok">حُفظ</span> : null}
      {errors._auth ? <p className="err">{errors._auth}</p> : null}
    </form>
  );
}

export function CycleForm() {
  const [name, setName] = useState("");
  const [date, setDate] = useState("2027-01-15");
  const [status, setStatus] = useState("planned");
  const { errors, busy, saved, send } = useErrors();

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await send("/api/cycles", "POST", {
          name,
          election_date: date,
          status,
        });
        if (ok) setName("");
      }}
    >
      <label>
        اسم الدورة
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        {errors.name ? <span className="err">{errors.name}</span> : null}
      </label>
      <label>
        تاريخ الاستحقاق
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {errors.election_date ? <span className="err">{errors.election_date}</span> : null}
      </label>
      <label>
        الحالة
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="planned">planned</option>
          <option value="active">active</option>
          <option value="closed">closed</option>
        </select>
        {errors.status ? <span className="err">{errors.status}</span> : null}
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الإنشاء…" : "إضافة دورة"}
      </button>
      {saved ? <span className="chip chip-ok">أُضيفت</span> : null}
    </form>
  );
}

export function CycleStatusForm({ cycleId, current }: { cycleId: string; current: string }) {
  const [status, setStatus] = useState(current);
  const { errors, busy, send } = useErrors();

  return (
    <form
      className="form-row"
      onSubmit={async (e) => {
        e.preventDefault();
        await send(`/api/cycles/${cycleId}`, "PATCH", { status });
      }}
    >
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="planned">planned</option>
        <option value="active">active</option>
        <option value="closed">closed</option>
      </select>
      <button className="btn" disabled={busy || status === current}>
        تحديث
      </button>
      {errors.status ? <span className="err">{errors.status}</span> : null}
    </form>
  );
}

export function RegionForm() {
  const [name, setName] = useState("");
  const { errors, busy, saved, send } = useErrors();

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await send("/api/regions", "POST", { name });
        if (ok) setName("");
      }}
    >
      <label>
        اسم المنطقة
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        {errors.name ? <span className="err">{errors.name}</span> : null}
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الإنشاء…" : "إضافة منطقة"}
      </button>
      {saved ? <span className="chip chip-ok">أُضيفت</span> : null}
    </form>
  );
}

export function TeamForm({ regions }: { regions: Option[] }) {
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const { errors, busy, saved, send } = useErrors();

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await send("/api/teams", "POST", {
          name,
          region_id: regionId || null,
        });
        if (ok) setName("");
      }}
    >
      <label>
        اسم الفريق
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        {errors.name ? <span className="err">{errors.name}</span> : null}
      </label>
      <label>
        المنطقة
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
          <option value="">—</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {errors.region_id ? <span className="err">{errors.region_id}</span> : null}
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الإنشاء…" : "إضافة فريق"}
      </button>
      {saved ? <span className="chip chip-ok">أُضيف</span> : null}
    </form>
  );
}
