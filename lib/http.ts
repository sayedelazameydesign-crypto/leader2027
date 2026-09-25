import { NextResponse } from "next/server";
import type { Fail } from "@/lib/validation/result";

export function failResponse(f: Fail): NextResponse {
  return NextResponse.json({ errors: f.errors }, { status: f.status });
}
