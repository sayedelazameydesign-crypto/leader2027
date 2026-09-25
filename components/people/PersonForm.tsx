"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RegionOption = { id: string; name: string };

export default function PersonForm({ regions }: { regions: RegionOption[] }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [regionId, setRegionId] = useState("");
  const [source, setSource] = useState("ميداني");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        full_name: fullName,
        phone: phone || null,
        region_id: regionId || null,
        source,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setFullName("");
      setPhone("");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setErrors(data?.errors ?? { _form: "تعذّر الحفظ" });
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        الاسم الكامل
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        {errors.full_name ? <span className="err">{errors.full_name}</span> : null}
      </label>
      <label>
        الهاتف (اختياري)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        {errors.phone ? <span className="err">{errors.phone}</span> : null}
      </label>
      <label>
        المنطقة (اختياري)
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
      <label>
        المصدر (وعي بالمصدر إلزامي)
        <input value={source} onChange={(e) => setSource(e.target.value)} required />
        {errors.source ? <span className="err">{errors.source}</span> : null}
      </label>
      {errors._form ? <p className="err">{errors._form}</p> : null}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الحفظ…" : "إضافة شخص"}
      </button>
    </form>
  );
}
