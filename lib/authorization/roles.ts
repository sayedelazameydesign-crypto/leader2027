export const ROLES = [
  "OWNER",
  "CAMPAIGN_ADMIN",
  "CAMPAIGN_MANAGER",
  "FIELD_COORDINATOR",
  "FIELD_WORKER",
  "VIEWER",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
