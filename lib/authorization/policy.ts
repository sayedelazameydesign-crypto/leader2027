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
  | "audit:view";

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
 * مصفوفة الصلاحيات — Product Contract §4.
 * «محدود» (تفسير معتمد): قراءة فقط دون create/patch.
 * صف «Assign task» محفوظ لـP3 (بلا كيان Task في VS2).
 * لا يُعتمد على إخفاء الأزرار كـauthorization — التنفيذ هنا ومنع على مستوى الخدمة/API.
 */
const MATRIX: Record<Role, Action[]> = {
  OWNER: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "users:manage", "audit:view",
  ],
  CAMPAIGN_ADMIN: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "users:manage", "audit:view",
  ],
  CAMPAIGN_MANAGER: [
    "dashboard:view", "people:view", "people:create", "people:update",
    "volunteers:view", "volunteers:create", "volunteers:update",
    "reports:view", "reports:create", "reports:update_notes", "reports:update_status",
    "users:manage", "audit:view",
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
  if (!MATRIX[actor.role]?.includes(action)) return false;

  // قاعدة موارد: عامل ميداني يعدّل ملاحظات تقريره هو فقط.
  if (
    action === "reports:update_notes" &&
    actor.role === "FIELD_WORKER" &&
    resource?.reported_by !== undefined
  ) {
    return resource.reported_by === actor.id;
  }

  return true;
}

export function actionsFor(role: Role): Action[] {
  return [...MATRIX[role]];
}
