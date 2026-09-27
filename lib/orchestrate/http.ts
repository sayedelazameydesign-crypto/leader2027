/**
 * V5.3 — مساعدات HTTP المشتركة لمسارات المنسّق (نفس نمط مسارات GEN-3).
 *
 * الأخطاء المعروفة ⇒ 400 · المصادقة ⇒ 401/403 · غير المتوقع يُرمى
 * (Next.js يحوّله 500 fail-closed بلا تسريب — لا 500 صريحة في الشفرة).
 */
import { NextResponse } from "next/server";
import type { Repos } from "@/lib/repositories/interfaces";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { can, type Action } from "@/lib/authorization/policy";
import { failResponse } from "@/lib/http";
import { fail } from "@/lib/validation/result";
import { WorkerError } from "@/lib/workers/types";
import { OrchestrateInputError } from "./service";

export type AuthedContext = { repos: Repos; userId: string };

export function guardRoute(req: Request, action: Action): AuthedContext | NextResponse {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;
  if (!can(user, action)) {
    return failResponse(fail(403, { _auth: `يتطلب ${action}` }));
  }
  return { repos, userId: user.id };
}

export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, res: failResponse(fail(400, { _form: "JSON غير صالح" })) };
  }
}

export function badRequest(field: string, message: string): NextResponse {
  return failResponse(fail(400, { [field]: message }));
}

/** `true` ⇒ عولجت كـ400 · غير المعروف يُرمى (500 الضمنية). */
export function mapKnownError(err: unknown): NextResponse | null {
  if (err instanceof OrchestrateInputError) return badRequest(err.field, err.message);
  if (err instanceof WorkerError) return badRequest("_form", err.message);
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
