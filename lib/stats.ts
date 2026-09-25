import type { Metric } from "./data";

export type StatsSummary = {
  totals: { count: number; percent: number; score: number };
  avgTrend: number;
  topMover: Metric | null;
};

export function summarize(metrics: Metric[]): StatsSummary {
  const totals = { count: 0, percent: 0, score: 0 };
  let trendSum = 0;
  let topMover: Metric | null = null;

  for (const m of metrics) {
    totals[m.unit] += m.value;
    trendSum += m.trend;
    if (!topMover || m.trend > topMover.trend) {
      topMover = m;
    }
  }

  const avgTrend = metrics.length
    ? Math.round((trendSum / metrics.length) * 10) / 10
    : 0;

  return { totals, avgTrend, topMover };
}
