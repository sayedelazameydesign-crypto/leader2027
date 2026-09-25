import { NextResponse } from "next/server";
import { demoMetrics } from "../../../lib/data";
import { summarize } from "../../../lib/stats";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    demo: true,
    metrics: demoMetrics,
    summary: summarize(demoMetrics),
  });
}
