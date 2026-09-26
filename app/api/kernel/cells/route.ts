/**
 * /api/kernel/cells — كتالوج الأنوية والأدوات للوكلاء (2027).
 *
 * GET       : كل الأنوية وأدواتها ومَقابضها بصيغة منظَّمة تُقرأ آليًا.
 * GET ?cell=: نواة واحدة بتفصيلها الكامل (أدواتها ومَقابضها وحالتها).
 *
 * هذا هو المدخل الذي يستعمله وكيل ذكاء اصطناعي ليعرف «ما يمكن فعله» قبل أن يطلب
 * موافقة بشرية — ثم ينفّذ عبر `/api/kernel/actions`.
 */
import { NextResponse } from "next/server";
import { getRepos } from "@/lib/repositories/container";
import { isResponse, requireUserForApi } from "@/lib/auth/request";
import { can } from "@/lib/authorization/policy";
import { failResponse } from "@/lib/http";
import { fail } from "@/lib/validation/result";
import { getKernel } from "@/lib/kernel/registry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const repos = getRepos();
  const user = requireUserForApi(repos, req);
  if (isResponse(user)) return user;

  if (!can(user, "dashboard:view")) {
    return failResponse(fail(403, { _auth: "قراءة الكتالوج تتطلب صلاحية عرض" }));
  }

  const url = new URL(req.url);
  const cellId = url.searchParams.get("cell");
  const boot = await getKernel();

  if (cellId) {
    const cell = boot.kernel.cell(cellId);
    if (!cell) return failResponse(fail(404, { cell: `نواة غير معروفة: ${cellId}` }));
    return NextResponse.json({
      cell: {
        ...cell,
        slots: boot.kernel.slots(cellId),
        toolDetails: boot.kernel.tools({ cell: cellId }),
      },
    });
  }

  return NextResponse.json({
    cells: boot.kernel.list().map((cell) => ({
      id: cell.id,
      version: cell.version,
      title: cell.title,
      corner: cell.corner,
      state: cell.state,
      provides: cell.provides,
      requires: cell.requires,
      emits: cell.emits,
      consumes: cell.consumes,
      slots: boot.kernel.slots(cell.id),
    })),
    tools: boot.kernel.tools(),
    count: boot.kernel.tools().length,
  });
}
