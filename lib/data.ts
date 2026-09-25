export type Metric = {
  id: string;
  label: string;
  value: number;
  unit: "count" | "percent" | "score";
  trend: number;
};

export const demoMetrics: Metric[] = [
  { id: "active-accounts", label: "الحسابات النشطة", value: 1284, unit: "count", trend: 4.2 },
  { id: "daily-transactions", label: "المعاملات اليومية", value: 356, unit: "count", trend: 1.1 },
  { id: "growth-rate", label: "معدل النمو", value: 12.5, unit: "percent", trend: 1.8 },
  { id: "performance-index", label: "مؤشر الأداء", value: 87, unit: "score", trend: 2.4 },
];
