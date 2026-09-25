"use client";

import { useEffect, useState } from "react";
import type { Metric } from "../lib/data";

type Health = { status: string; service: string; version: string; time: string };

type StatsSummary = {
  totals: { count: number; percent: number; score: number };
  avgTrend: number;
  topMover: Metric | null;
};

type StatsPayload = {
  generatedAt: string;
  demo: boolean;
  metrics: Metric[];
  summary: StatsSummary;
};

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; health: Health; stats: StatsPayload };

const fmt = new Intl.NumberFormat("ar-EG");

function formatValue(m: Metric): string {
  if (m.unit === "percent") return `${fmt.format(m.value)}٪`;
  if (m.unit === "score") return `${fmt.format(m.value)}/100`;
  return fmt.format(m.value);
}

export default function LiveDashboard() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [hRes, sRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/stats"),
        ]);
        if (!hRes.ok || !sRes.ok) {
          throw new Error(`HTTP ${hRes.status}/${sRes.status}`);
        }
        const health = (await hRes.json()) as Health;
        const stats = (await sRes.json()) as StatsPayload;
        if (!cancelled) setState({ phase: "ready", health, stats });
      } catch (e) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: e instanceof Error ? e.message : "خطأ غير معروف",
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="dash">
      <div className="dash-head">
        <h2>المقاييس الحية</h2>
        {state.phase === "loading" && (
          <span className="chip chip-warn">جارٍ الاتصال بالخدمة…</span>
        )}
        {state.phase === "error" && (
          <span className="chip chip-err">انقطع الاتصال</span>
        )}
        {state.phase === "ready" && (
          <span className="chip chip-ok">
            متصل — {state.health.service} v{state.health.version}
            {state.stats.demo ? " · بيانات تجريبية" : ""}
          </span>
        )}
      </div>

      {state.phase === "loading" && (
        <p className="muted">جارٍ تحميل المقاييس من /api/stats…</p>
      )}

      {state.phase === "error" && (
        <p className="err">تعذّر الاتصال بالخدمة: {state.message}</p>
      )}

      {state.phase === "ready" && (
        <>
          <div className="grid">
            {state.stats.metrics.map((m) => (
              <article key={m.id} className="metric">
                <span className="label">{m.label}</span>
                <span className="value">{formatValue(m)}</span>
                <span className={m.trend >= 0 ? "trend-up" : "trend-down"}>
                  {m.trend >= 0 ? "▲" : "▼"} {fmt.format(Math.abs(m.trend))}٪
                </span>
              </article>
            ))}
          </div>
          <p className="summary">
            متوسط الاتجاه: <strong>{fmt.format(state.stats.summary.avgTrend)}٪</strong>
            {" — "}
            الأعلى حركة:{" "}
            <strong>
              {state.stats.summary.topMover?.label ?? "لا يوجد"}
            </strong>
          </p>
        </>
      )}
    </section>
  );
}
