import { describe, it, expect } from "vitest";
import { summarize } from "./stats";
import type { Metric } from "./data";

const sample: Metric[] = [
  { id: "a", label: "أ", value: 10, unit: "count", trend: 1 },
  { id: "b", label: "ب", value: 20, unit: "count", trend: 3 },
  { id: "c", label: "ج", value: 50, unit: "percent", trend: 2 },
  { id: "d", label: "د", value: 80, unit: "score", trend: -1 },
];

describe("summarize", () => {
  it("يجمع القيم حسب الوحدة", () => {
    const s = summarize(sample);
    expect(s.totals).toEqual({ count: 30, percent: 50, score: 80 });
  });

  it("يحسب متوسط الاتجاه بدقة منزلة واحدة", () => {
    const s = summarize(sample);
    expect(s.avgTrend).toBe(1.3);
  });

  it("يحدد المقاي الأعلى حركة", () => {
    const s = summarize(sample);
    expect(s.topMover?.id).toBe("b");
  });

  it("يعامل المصفوفة الفارغة بأمان", () => {
    const s = summarize([]);
    expect(s.totals).toEqual({ count: 0, percent: 0, score: 0 });
    expect(s.avgTrend).toBe(0);
    expect(s.topMover).toBeNull();
  });
});
