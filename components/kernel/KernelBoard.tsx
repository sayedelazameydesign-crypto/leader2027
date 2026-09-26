"use client";

import { useCallback, useEffect, useState } from "react";

type Slot = {
  key: string;
  label: { ar: string; en: string };
  default: string | number | boolean;
  effect: { ar: string; en: string };
};

type CellView = {
  id: string;
  version: string;
  title: { ar: string; en: string };
  corner: string;
  state: string;
  provides: string[];
  requires: string[];
  tools: string[];
  config: Record<string, string | number | boolean>;
  slots: Slot[];
  swaps: number;
  lastError: string | null;
};

type Snapshot = {
  at: string;
  stats: { total: number; active: number; degraded: number; blocked: number; retired: number; swaps: number };
  capabilities: Array<{ id: string; label: { ar: string; en: string }; risk: string; providedBy: string }>;
  cells: CellView[];
  failures: number;
};

type Approval = {
  id: string;
  cell: string;
  tool: string;
  actor: string;
  reason: string;
  state: string;
};

const STATE_LABEL: Record<string, string> = {
  active: "نشطة",
  mounted: "مُركَّبة",
  degraded: "معطوبة",
  blocked: "محجوبة",
  retired: "متقاعدة",
  declared: "مُعلَنة",
};

const STATE_CLASS: Record<string, string> = {
  active: "chip chip-ok",
  mounted: "chip chip-ok",
  degraded: "chip chip-warn",
  blocked: "chip chip-warn",
  retired: "chip",
  declared: "chip",
};

export default function KernelBoard({ canConfigure, canDecide }: { canConfigure: boolean; canDecide: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/kernel", { cache: "no-store" });
    if (!res.ok) {
      setNote({ kind: "err", text: `تعذّر تحميل النواة (${res.status})` });
      return;
    }
    const data = (await res.json()) as Snapshot;
    setSnapshot(data);

    if (canDecide) {
      const pending = await fetch("/api/kernel/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tool", tool: "ai.pending_approvals", input: {} }),
      });
      if (pending.ok) {
        const body = (await pending.json()) as { status: string; value?: { requests: Approval[] } };
        setApprovals(body.value?.requests ?? []);
      }
    }
  }, [canDecide]);

  useEffect(() => {
    void load();
  }, [load]);

  async function configure(cell: CellView, key: string, value: string | number | boolean) {
    setBusy(cell.id);
    setNote(null);
    try {
      const res = await fetch("/api/kernel", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cell: cell.id, patch: { [key]: value } }),
      });
      const body = await res.json();
      if (res.ok) {
        setNote({ kind: "ok", text: `تم تعديل مَقبض ${cell.id}.${key} — الركن وحده تأثّر` });
      } else {
        setNote({ kind: "err", text: body?.errors?._form ?? "تعذّر التعديل" });
      }
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function decide(id: string, decision: "grant" | "deny") {
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch("/api/kernel/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: decision,
          approval_id: id,
          ...(decision === "deny" ? { reason: "رُفض من لوحة النواة" } : {}),
        }),
      });
      setNote(
        res.ok
          ? { kind: "ok", text: decision === "grant" ? "تم اعتماد الطلب — التصريح لاستخدام واحد" : "تم رفض الطلب" }
          : { kind: "err", text: "تعذّر تنفيذ القرار" },
      );
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (!snapshot) return <p className="muted">جارٍ إقلاع النواة الحيّة…</p>;

  const { stats } = snapshot;

  return (
    <>
      {note ? (
        <p className={note.kind === "ok" ? "chip chip-ok" : "chip chip-warn"} style={{ marginBottom: 12 }}>
          {note.text}
        </p>
      ) : null}

      <section className="cards">
        <div className="card">
          <span className="muted">أنوية مُركَّبة</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="card">
          <span className="muted">نشطة</span>
          <strong>{stats.active}</strong>
        </div>
        <div className="card">
          <span className="muted">معطوبة / محجوبة</span>
          <strong>
            {stats.degraded} / {stats.blocked}
          </strong>
        </div>
        <div className="card">
          <span className="muted">استبدالات ساخنة</span>
          <strong>{stats.swaps}</strong>
        </div>
        <div className="card">
          <span className="muted">قدرات مُشبَعة</span>
          <strong>{snapshot.capabilities.length}</strong>
        </div>
      </section>

      <h2>المَوافقات المعلَّقة</h2>
      {!canDecide ? (
        <p className="muted">قرارات الموافقة تتطلب صلاحية إدارة المستخدمين (Manager+).</p>
      ) : approvals.length === 0 ? (
        <p className="muted">لا طلبات معلَّقة — كل ما نفّذه الوكلاء كان بموافقة بشرية أو بقراءة فقط.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>الطلب</th>
              <th>الأداة</th>
              <th>الوكيل</th>
              <th>السبب</th>
              <th>القرار</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
                <td>
                  <code>{a.id}</code>
                </td>
                <td>
                  <code>{a.tool}</code>
                </td>
                <td>{a.actor}</td>
                <td>{a.reason}</td>
                <td>
                  <button disabled={busy === a.id} onClick={() => decide(a.id, "grant")} className="btn">
                    اعتماد
                  </button>{" "}
                  <button disabled={busy === a.id} onClick={() => decide(a.id, "deny")} className="btn btn-danger">
                    رفض
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>الأنوية الذرية — ركن لكل جزء</h2>
      <p className="muted">
        كل نواة مكتفية ذاتيًا: تُعلن قدراتها ومَقابضها، وتُعدَّل وحدها. تغيير مَقبض في ركن لا يمسّ غيره — لا في الكود ولا في
        الإعدادات.
      </p>

      {snapshot.cells.map((cell) => (
        <section key={cell.id} className="panel" style={{ marginBottom: 16 }}>
          <header className="panel-head">
            <div>
              <strong>{cell.title.ar}</strong>{" "}
              <span className="muted">
                <code>{cell.id}</code> · v{cell.version} · {cell.corner}
              </span>
            </div>
            <span className={STATE_CLASS[cell.state] ?? "chip"}>{STATE_LABEL[cell.state] ?? cell.state}</span>
          </header>

          <p className="muted" style={{ marginTop: 0 }}>
            يُشبع: {cell.provides.map((c) => <code key={c}>{c} </code>)} · يحتاج:{" "}
            {cell.requires.length ? cell.requires.map((c) => <code key={c}>{c} </code>) : "لا شيء"}
            {cell.swaps > 0 ? ` · استُبدلت ${cell.swaps} مرة` : ""}
          </p>

          {cell.lastError ? <p className="chip chip-warn">{cell.lastError}</p> : null}

          {cell.slots.length === 0 ? (
            <p className="muted">لا مَقابض تعديل في هذا الركن.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>المَقبض</th>
                  <th>القيمة</th>
                  <th>الأثر</th>
                </tr>
              </thead>
              <tbody>
                {cell.slots.map((slot) => {
                  const current = cell.config[slot.key];
                  return (
                    <tr key={slot.key}>
                      <td>
                        <code>{slot.key}</code>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {slot.label.ar}
                        </div>
                      </td>
                      <td>
                        {typeof slot.default === "boolean" ? (
                          <input
                            type="checkbox"
                            checked={current === true}
                            disabled={!canConfigure || busy === cell.id}
                            onChange={(e) => configure(cell, slot.key, e.target.checked)}
                            aria-label={slot.label.ar}
                          />
                        ) : typeof slot.default === "number" ? (
                          <input
                            type="number"
                            defaultValue={Number(current)}
                            disabled={!canConfigure || busy === cell.id}
                            onBlur={(e) => {
                              const next = Number(e.target.value);
                              if (next !== Number(current)) void configure(cell, slot.key, next);
                            }}
                            aria-label={slot.label.ar}
                            style={{ width: 110 }}
                          />
                        ) : (
                          <input
                            type="text"
                            defaultValue={String(current)}
                            disabled={!canConfigure || busy === cell.id}
                            onBlur={(e) => {
                              if (e.target.value !== String(current)) void configure(cell, slot.key, e.target.value);
                            }}
                            aria-label={slot.label.ar}
                          />
                        )}
                      </td>
                      <td className="muted">{slot.effect.ar}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!canConfigure ? <p className="muted">التعديل يتطلب صلاحية إدارة الإعدادات (Manager+).</p> : null}
        </section>
      ))}
    </>
  );
}
