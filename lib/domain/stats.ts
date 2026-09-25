export type Metric = {
  id: string;
  label: string;
  value: number;
  unit: "count" | "percent" | "score";
  trend: number;
};

export type StatsSummary = {
  totals: { count: number; percent: number; score: number };
  avgTrend: number;
  topMover: Metric | null;
};

/** دالة نقية — تُستعمل في التقارير لاحقاً. */
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

export type Kpis = {
  people: number;
  volunteers: number;
  reports: number;
  peopleContacted: number;
  volunteersPresent: number;
};

export function computeKpis(records: {
  peopleCount: number;
  volunteers: Array<{ status: string }>;
  reports: Array<{ people_contacted: number; volunteers_present: number }>;
}): Kpis {
  return {
    people: records.peopleCount,
    volunteers: records.volunteers.filter((v) => v.status === "active").length,
    reports: records.reports.length,
    peopleContacted: records.reports.reduce((s, r) => s + r.people_contacted, 0),
    volunteersPresent: records.reports.reduce((s, r) => s + r.volunteers_present, 0),
  };
}
