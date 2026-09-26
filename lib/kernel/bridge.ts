/**
 * الجسر بين النواة والطبقات القائمة (domain / persistence / auth).
 *
 * هذا هو **الخط الوحيد** الذي تعبره الأنوية الذرية إلى النظام القائم.
 * الأنوية لا تستورد المخزن ولا الجلسة مباشرة — تستعمل ما هنا فقط.
 */
import type { Repos } from "@/lib/repositories/interfaces";
import { getRepos } from "@/lib/repositories/container";
import { ROLES } from "@/lib/authorization/roles";
import type { Role } from "@/lib/authorization/roles";
import type { Actor } from "./types";

/** فاعل النطاق (شكل سياسة الإذن القائمة). */
export type DomainActor = { id: string; role: Role };

/**
 * تحويل فاعل النواة إلى فاعل النطاق.
 *
 * دور غير معروف (مثل `SYSTEM` أو دور وكيل مخصّص) يُمرَّر كما هو:
 * `can()` تبحث في المصفوفة فلا تجد شيئًا ⇒ **منع افتراضي** لكل إجراء.
 * هذا مقصود: لا نمنح صلاحية بالخطأ لمُعرِّف لا نعرفه.
 */
export function toDomainActor(actor: Actor): DomainActor {
  return { id: actor.id, role: actor.role as Role };
}

/** هل يملك هذا الفاعل دورًا معروفًا في مصفوفة الصلاحيات؟ */
export function hasKnownRole(actor: Actor): boolean {
  return (ROLES as readonly string[]).includes(actor.role);
}

/** المخزن الحالي — وفي وضع file يُعاد بناءه لكل استدعاء (اتساق عوالم module). */
export function repos(): Repos {
  return getRepos();
}

/** يقرأ مَقبضًا رقميًا من إعدادات الخلية بحدود آمنة. */
export function numberSlot(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(n, min), max);
}

/** يقرأ مَقبضًا نصيًا من إعدادات الخلية بحدود آمنة. */
export function stringSlot(value: unknown, fallback: string, maxLength = 200): string {
  const s = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  return s.slice(0, maxLength);
}

/** نتيجة فشل موحّدة ترميها الأدوات فتُلتقط معزولة في النواة. */
export class ToolFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolFailure";
    this.code = code;
  }
}
