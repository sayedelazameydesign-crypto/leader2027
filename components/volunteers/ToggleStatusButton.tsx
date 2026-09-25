"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ToggleStatusButton({
  volunteerId,
  current,
}: {
  volunteerId: string;
  current: "active" | "inactive";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = current === "active" ? "inactive" : "active";

  async function toggle() {
    setBusy(true);
    await fetch(`/api/volunteers/${volunteerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button className="btn" onClick={toggle} disabled={busy}>
      {busy ? "جارٍ التحديث…" : next === "inactive" ? "إيقاف مؤقت" : "إعادة تفعيل"}
    </button>
  );
}
