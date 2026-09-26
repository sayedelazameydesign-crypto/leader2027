import type { Role } from "./roles";

export type Action =
  | "dashboard:view"
  | "people:view"
  | "people:create"
  | "people:update"
  | "volunteers:view"
  | "volunteers:create"
  | "volunteers:update"
  | "reports:view"
  | "reports:create"
  | "reports:update_notes"
  | "reports:update_status"
  | "users:manage"
  | "settings:manage"
  | "audit:view";

/**
 * عقد الممثل — قرار المراجعة **D-01 = OPTION B** (`docs/audit/pr8-review-followup.md`):
 * `role` هو مفتاح قرار التفويض (مصفوفة §4 + منع افتراضي لدور مجهول)، أمّا `id` فليس
 * شرطًا عامًا — يُشترط فقط حيث تتطلب القاعدة هوية/ملكية (اليوم: ملكية
 * `reports:update_notes` للعامل الميداني). لا validation عام لـ`id` هنا، ولا عزل فرق:
 * `team_id` مُعلَن ولا يدخل في `can()` (F-02 — قرار مؤجل).
 */
export type Actor = {
  id: string;
  role: Role;
  team_id?: string | null;
};

export type Resource = {
  reported_by?: string;
  team_id?: string | null;
};

/**
 * مصفوفة الصلاحيات — Product Contract §4 (+ VS3: settings:manage للـManager+).
 * «محدود» (تفسير معتمد): قراءة فقط دون create/patch.
 * صف «Assign task» محفوظ لـP3 (بلا كيان Task).
 * لا يُعتمد على إخفاء الأزرار كـauthorization — التنفيذ هنا ومنع على مستوى الخدمة/API.
 */
const MATRIX: Record<Role, Action[]> = {
  OWNER: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "users:manage", "settings:manage", "audit:view",
  ],
  CAMPAIGN_ADMIN: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "users:manage", "settings:manage", "audit:view",
  ],
  CAMPAIGN_MANAGER: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "users:manage", "settings:manage", "audit:view",
  ],
  FIELD_COORDINATOR: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "audit:view",
  ],
  FIELD_WORKER: [
    "dashboard:view", "people:view", "volunteers:view",
    "reports:view", "reports:create", "reports:update_notes",
  ],
  VIEWER: [
    "dashboard:view", "people:view", "volunteers:view", "reports:view",
  ],
};

export function can(actor: Actor, action: Action, resource?: Resource): boolean {
  /**
   * منع افتراضي صريح بدل الانهيار (F-01b).
   * `MATRIX[role]` بحث في كائن له prototype: دور تالف مثل "constructor" أو
   * "toString" كان يُعيد دالة ثم يرمي TypeError (⇒ 500 في أي route بدل 403).
   * `Object.hasOwn` يحصر البحث في صفوف المصفوفة نفسها، فيسقط الدور غير المعروف
   * أو غير النصي — والممثل التالف — على **منع**، وهو الثابت الموثّق أصلًا في
   * `lib/kernel/bridge.ts` («منع افتراضي لكل إجراء») و`lib/kernel/kernel.ts`.
   */
  const role = (actor as Actor | null | undefined)?.role;
  if (typeof role !== "string" || !Object.hasOwn(MATRIX, role)) return false;
  if (!MATRIX[role as Role].includes(action)) return false;

  /**
   * قاعدة موارد: عامل ميداني يعدّل ملاحظات تقريره هو فقط (F-01a).
   * **غياب سياق الملكية أو تلفه ⇒ منع** — لا منح صامت: أنواع TypeScript ليست
   * تحققًا في زمن التشغيل، والمخزن مستند واحد بلا قيود كيانية
   * (`lib/persistence/schema.sql` + `postgres.ts` يقرأ `doc as Store`)، فلا يُعتمد
   * على الطبقات الأعلى. المنح يحتاج مطابقة صريحة: نص غير فارغ يساوي هوية الممثل.
   */
  if (action === "reports:update_notes" && role === "FIELD_WORKER") {
    const owner = resource?.reported_by;
    return typeof owner === "string" && owner.length > 0 && owner === actor.id;
  }

  return true;
}

export function actionsFor(role: Role): Action[] {
  // نفس فئة F-01b: دور تالف ⇒ قائمة فارغة (= لا صلاحيات) بدل TypeError.
  return Object.hasOwn(MATRIX, role) ? [...MATRIX[role]] : [];
}
