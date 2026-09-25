"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = [
  "OWNER",
  "CAMPAIGN_ADMIN",
  "CAMPAIGN_MANAGER",
  "FIELD_COORDINATOR",
  "FIELD_WORKER",
  "VIEWER",
] as const;

type Option = { id: string; name: string };

export function UserCreateForm({
  teams,
  regions,
}: {
  teams: Option[];
  regions: Option[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("FIELD_WORKER");
  const [teamId, setTeamId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        team_id: teamId || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setEmail("");
      setPassword("");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setErrors(data?.errors ?? { _form: "تعذّر الإنشاء" });
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        الاسم
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        {errors.name ? <span className="err">{errors.name}</span> : null}
      </label>
      <label>
        البريد
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {errors.email ? <span className="err">{errors.email}</span> : null}
      </label>
      <label>
        كلمة المرور (8+)
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {errors.password ? <span className="err">{errors.password}</span> : null}
      </label>
      <label>
        الدور
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {errors.role ? <span className="err">{errors.role}</span> : null}
      </label>
      <label>
        الفريق (اختياري)
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">—</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {errors.email ? null : null}
      {errors._form ? <p className="err">{errors._form}</p> : null}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "جارٍ الإنشاء…" : "إنشاء مستخدم"}
      </button>
    </form>
  );
}

export function UserRoleForm({
  userId,
  currentRole,
  currentTeam,
  teams,
  regions,
  currentRegion,
}: {
  userId: string;
  currentRole: string;
  currentTeam: string | null;
  currentRegion: string | null;
  teams: Option[];
  regions: Option[];
}) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [teamId, setTeamId] = useState(currentTeam ?? "");
  const [regionId, setRegionId] = useState(currentRegion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = role !== currentRole || teamId !== (currentTeam ?? "") || regionId !== (currentRegion ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role,
        team_id: teamId || null,
        region_id: regionId || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.errors?._auth ?? Object.values(data?.errors ?? {})[0] as string ?? "تعذّر التحديث");
    }
  }

  return (
    <form className="form-row" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        <option value="">فريق: —</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
        <option value="">منطقة: —</option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button className="btn" disabled={busy || !dirty}>
        {busy ? "جارٍ…" : "حفظ"}
      </button>
      {error ? <span className="err">{error}</span> : null}
    </form>
  );
}
