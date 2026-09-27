/**
 * GEN-4 — قواعد الملكية الخالصة (pure — بلا مخزن، تُختبَر وحدها).
 */
import type { TaskLeaseRecord } from "@/lib/repositories/interfaces";
import { canonicalize, sha256hex } from "@/lib/tasks/hashing";

/** الأحدث tokenًا — الفائز الوحيد المحتمل (fencing). */
export function latestLeaseOf(leases: TaskLeaseRecord[]): TaskLeaseRecord | null {
  if (!leases.length) return null;
  return leases.reduce((a, b) => (b.fencingToken > a.fencingToken ? b : a));
}

/** موعد التجديد = `expiresAt − margin` — بعده الـlease قابل للاسترداد (R8/D4). */
export function renewalDeadlineMs(lease: TaskLeaseRecord, marginMs: number): number {
  return Date.parse(lease.expiresAt) - marginMs;
}

/** هل الـlease قابل للاسترداد الآن؟ مُسلَّم أو فات موعد تجديده. */
export function isReclaimable(lease: TaskLeaseRecord, nowMs: number, marginMs: number): boolean {
  if (lease.releasedAt !== null) return true;
  return nowMs >= renewalDeadlineMs(lease, marginMs);
}

/** هل المالك ما زال شرعيًا؟ الأحدث + غير مُسلَّم + قبل الانتهاء الصلب. */
export function isHolding(
  lease: TaskLeaseRecord,
  latest: TaskLeaseRecord | null,
  workerId: string,
  nowMs: number,
): boolean {
  if (!latest || latest.id !== lease.id) return false;
  if (lease.releasedAt !== null) return false;
  if (lease.workerId !== workerId) return false;
  return nowMs < Date.parse(lease.expiresAt);
}

/** توكن المحاولة = بصمة (المقترح + الـfencing) — يوثّق أي حقبة نفّذت (§6/D5). */
export function attemptToken(proposalHash: string, fencingToken: number): string {
  return sha256hex(`GEN4/ATTEMPT/v1|${proposalHash}|${fencingToken}`);
}

/** بصمة نتيجة النداء — تُحفَظ مع السجل للتحقق اللاحق. */
export function resultHash(result: unknown): string {
  return sha256hex(`GEN4/RESULT/v1|${canonicalize(result)}`);
}
