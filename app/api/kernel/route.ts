/**
 * /api/kernel — سطح إدارة الأنوية الذرية.
 *
 * GET  : الصورة الحيّة (الأنوية، حالاتها، قدراتها، مَقابضها، إحصاءاتها).
 * PATCH: تعديل مَقابض نواة واحدة — `settings:manage` فقط.
 *
 * ملاحظة معمارية: النواة تُقلع كوحدة واحدة في عالم route-handlers،
 * والصفحات تقرأ عبر هذا المسار (لا استيراد مباشر) لتفادي تعدد عوالم module.
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { can } from "@/lib/authorization/policy";
import { failResponse } from "@/lib/http";
import { getKernel } from "@/lib/kernel/registry";
import { fail, ok, type Result } from "@/lib/validation/result";
import type { Actor } from "@/lib/kernel/types";

export const dynamic = "force-dynamic";

/** يحوّل مستخدم الجلسة إلى فاعل نواة بشري. */
function actorFrom(user: { id: string; role: string }): Actor {
  return { id: user.id, role: user.role, kind: "human" };
}

export async function GET(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;

  if (!can(user, "dashboard:view")) {
    return failResponse(fail(403, { _auth: "قراءة النواة تتطلب صلاحية عرض" }));
  }

  const boot = await getKernel();
  const snapshot = boot.kernel.snapshot();

  return NextResponse.json({
    at: snapshot.at,
    stats: snapshot.stats,
    capabilities: snapshot.capabilities.map((c) => ({
      id: c.id,
      label: c.label,
      risk: c.risk,
      providedBy: c.providedBy,
    })),
    cells: snapshot.cells.map((cell) => ({
      ...cell,
      slots: boot.kernel.slots(cell.id),
    })),
    approvals: {
      pending: boot.kernel.approvals.pending().length,
    },
    failures: boot.kernel.failureCount,
  });
}

export async function PATCH(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;

  if (!can(user, "settings:manage")) {
    return failResponse(fail(403, { _auth: "تعديل مَقابض الأنوية يتطلب settings:manage" }));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failResponse(fail(400, { _form: "JSON غير صالح" }));
  }

  const input = (body ?? {}) as { cell?: unknown; patch?: unknown };
  const cellId = typeof input.cell === "string" ? input.cell : "";
  if (!cellId) return failResponse(fail(400, { cell: "معرّف النواة مطلوب" }));
  if (typeof input.patch !== "object" || input.patch === null) {
    return failResponse(fail(400, { patch: "كائن التعديلات مطلوب" }));
  }

  const boot = await getKernel();
  const result: Result<{ cell: string; config: Record<string, string | number | boolean>; changed: string[] }> = (() => {
    try {
      const applied = boot.kernel.configure(cellId, input.patch as Record<string, unknown>, actorFrom(user));
      return ok({
        cell: applied.id,
        config: applied.config as Record<string, string | number | boolean>,
        changed: applied.changed,
      });
    } catch (err) {
      return fail(400, {
        _form: err instanceof Error ? err.message : "تعذّر تطبيق التعديل",
      });
    }
  })();

  if (!result.ok) return failResponse(result);

  // النواة التالية قد تعتمد على مَقبض تغيّر — نُبقي السلوك صريحًا: لا إعادة إقلاع.
  return NextResponse.json(result.value);
}
