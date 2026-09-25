import type { AuditEvent, Repos } from "@/lib/repositories/interfaces";
import type { Role } from "@/lib/authorization/roles";

export type AuditActor = { id: string; role: Role };

/** كل mutation في النظام يمرّ من هنا — Product Contract: كل تغيير ينشئ حدث تدقيق. */
export function recordAudit(
  repos: Repos,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  meta?: Record<string, string | number>,
): AuditEvent {
  return repos.audit.append({
    actor_id: actor.id,
    actor_role: actor.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    at: new Date().toISOString(),
    meta: meta ?? null,
  });
}
