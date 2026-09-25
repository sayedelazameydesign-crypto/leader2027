import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "leader2027",
    version: "0.1.0",
    time: new Date().toISOString(),
  });
}
