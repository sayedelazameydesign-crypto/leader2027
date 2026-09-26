/**
 * جذر التركيب (Composition Root) — **المكان الوحيد** الذي يعرف قائمة الأنوية.
 *
 * لماذا هذا مهم: النواة لا تعرف الخلايا، والخلايا لا تعرف بعضها.
 * لإضافة/إزالة/استبدال ركن: عدّل السطر في `CELLS` هنا فقط — لا شيء آخر.
 */
import { Kernel, type KernelOptions } from "./kernel";
import type { Cell, CellId, LifecycleState } from "./types";

import { authCell } from "@/lib/cells/auth";
import { peopleCell } from "@/lib/cells/people";
import { volunteersCell } from "@/lib/cells/volunteers";
import { fieldCell } from "@/lib/cells/field";
import { reportingCell } from "@/lib/cells/reporting";
import { settingsCell } from "@/lib/cells/settings";
import { auditCell } from "@/lib/cells/audit";
import { aiCell } from "@/lib/cells/ai";

/** ترتيب التركيب — الأنوية تُحاول التركيب بالترتيب، والمحجوب يُعاد فحصه لاحقًا. */
export const CELLS: readonly Cell[] = Object.freeze([
  authCell,
  peopleCell,
  volunteersCell,
  fieldCell,
  reportingCell,
  settingsCell,
  auditCell,
  aiCell,
]);

export type BootReport = {
  kernel: Kernel;
  states: Record<CellId, LifecycleState>;
  mounts: number;
  blocked: CellId[];
  degraded: CellId[];
};

/**
 * إقلاع النواة الحيّة — تسجيل كل الخلايا ثم التشغيل.
 * الخلية التي تفشل تُعزَل ولا تمنع إقلاع البقية (مبدأ عزل الفشل).
 */
export async function bootKernel(options: KernelOptions = {}): Promise<BootReport> {
  const kernel = new Kernel(options);
  const states: Record<CellId, LifecycleState> = {};
  const blocked: CellId[] = [];
  const degraded: CellId[] = [];

  for (const cell of CELLS) {
    try {
      states[cell.manifest.id] = kernel.register(cell);
    } catch (err) {
      // خلية معطوبة تمامًا: لا تُسقط الإقلاع — تُسجَّل وتُتخطّى
      states[cell.manifest.id] = "blocked";
      blocked.push(cell.manifest.id);
      kernel.publish("kernel.cell.failed", "kernel", {
        cell: cell.manifest.id,
        phase: "register",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await kernel.start();

  for (const runtime of kernel.list()) {
    states[runtime.id] = runtime.state;
    if (runtime.state === "blocked" && !blocked.includes(runtime.id)) blocked.push(runtime.id);
    if (runtime.state === "degraded" && !degraded.includes(runtime.id)) degraded.push(runtime.id);
  }

  return {
    kernel,
    states,
    mounts: Object.values(states).filter((s) => s === "active").length,
    blocked,
    degraded,
  };
}

/**
 * نواة العملية الواحدة (singleton) — تُبنى مرة واحدة عند أول استعمال.
 * الاختبارات تستعمل `bootKernel()` مباشرة لعزل كامل.
 */
let singleton: Promise<BootReport> | null = null;

export function getKernel(): Promise<BootReport> {
  if (!singleton) singleton = bootKernel();
  return singleton;
}

/** إعادة الإقلاع — بعد استبدال نواة ذرية أو في الاختبارات. */
export async function rebootKernel(options: KernelOptions = {}): Promise<BootReport> {
  singleton = bootKernel(options);
  return singleton;
}
