import type { Repos, Region, Team, User, AuditEvent } from "@/lib/repositories/interfaces";
import { hashPassword } from "@/lib/auth/password";
import type { Person } from "@/lib/domain/people/person";
import type { Volunteer } from "@/lib/domain/volunteers/volunteer";
import type { FieldReport } from "@/lib/domain/field/field-report";
import { emptyStore, reposFromStore, type Store } from "@/lib/persistence/memory";

/**
 * بيانات تشغيلية تجريبية (seed-only) — مستخدم لكل دور بحسب مصفوفة الصلاحيات.
 * كلمات المرور هنا للتشغيل/الاختبار فقط وليست بيانات إنتاجية.
 * معرّفات ثابتة عمداً ليتمكن smoke/CI من الإشارة إليها.
 */
export const SEED_PASSWORD = "Demo!2345";

const now = new Date().toISOString();

export const SEED = {
  regions: [
    { id: "region-giza", name: "الجيزة" },
    { id: "region-haram", name: "الهرم" },
    { id: "region-feisal", name: "فيصل" },
  ],
  teams: [
    { id: "team-a", name: "الفريق الميداني أ", region_id: "region-giza" },
    { id: "team-b", name: "الفريق الميداني ب", region_id: "region-haram" },
  ],
  users: [
    { id: "user-owner", email: "owner@leader2027.test", name: "مالك الحملة", role: "OWNER", team_id: null, region_id: null },
    { id: "user-admin", email: "admin@leader2027.test", name: "مدير النظام", role: "CAMPAIGN_ADMIN", team_id: null, region_id: null },
    { id: "user-manager", email: "manager@leader2027.test", name: "مدير الحملة", role: "CAMPAIGN_MANAGER", team_id: null, region_id: null },
    { id: "user-coordinator", email: "coordinator@leader2027.test", name: "منسق ميداني", role: "FIELD_COORDINATOR", team_id: "team-a", region_id: "region-giza" },
    { id: "user-worker", email: "worker@leader2027.test", name: "عامل ميداني", role: "FIELD_WORKER", team_id: "team-a", region_id: "region-giza" },
    { id: "user-viewer", email: "viewer@leader2027.test", name: "مُطلع", role: "VIEWER", team_id: null, region_id: null },
  ],
  people: [
    { id: "person-1", full_name: "أحمد محمود", phone: "01012345678", region_id: "region-giza", source: "ميداني" },
    { id: "person-2", full_name: "فاطمة علي", phone: "01112345678", region_id: "region-haram", source: "تسجيل" },
    { id: "person-3", full_name: "خالد حسن", phone: "01212345678", region_id: "region-feisal", source: "إحالة" },
  ],
  volunteers: [
    { id: "volunteer-1", person_id: "person-1", team_id: "team-a", status: "active" },
    { id: "volunteer-2", person_id: "person-2", team_id: "team-b", status: "active" },
  ],
  reports: [
    {
      id: "report-1",
      region_id: "region-giza",
      team_id: "team-a",
      reported_by: "user-worker",
      report_date: "2026-09-24",
      activity: "جولة تواصل محلية",
      people_contacted: 10,
      volunteers_present: 2,
      notes: "جولة أولى",
    },
    {
      id: "report-2",
      region_id: "region-haram",
      team_id: "team-b",
      reported_by: "user-coordinator",
      report_date: "2026-09-25",
      activity: "لقاء توعوي",
      people_contacted: 5,
      volunteers_present: 3,
      notes: "",
    },
  ],
};

export function seededStore(): Store {
  const store = emptyStore();

  store.regions = SEED.regions.map((r): Region => ({ ...r }));
  store.teams = SEED.teams.map((t): Team => ({ ...t }));
  store.users = SEED.users.map(
    (u): User => ({
      ...u,
      role: u.role as User["role"],
      password_hash: hashPassword(SEED_PASSWORD),
      created_at: now,
    }),
  );
  store.people = SEED.people.map(
    (p): Person => ({ ...p, created_at: now, updated_at: now }),
  );
  store.volunteers = SEED.volunteers.map(
    (v): Volunteer => ({
      ...v,
      status: v.status as Volunteer["status"],
      joined_at: now,
      created_at: now,
      updated_at: now,
    }),
  );
  store.reports = SEED.reports.map(
    (r): FieldReport => ({
      ...r,
      status: "submitted",
      created_at: now,
      updated_at: now,
    }),
  );

  store.audit.push({
    id: "audit-seed-1",
    actor_id: "system",
    actor_role: "OWNER",
    action: "system.seed",
    entity_type: "system",
    entity_id: "seed",
    at: now,
    meta: { note: "seed bootstrap (ليس mutation مستخدماً)" },
  } satisfies AuditEvent);

  return store;
}

export function applySeed(repos: Repos): void {
  // للتوافق: تُستعمل seededStore مباشرةً في المحوّلين.
  void repos;
}

/** اسم مختصر للتوافق مع container. */
export const seededStoreFrom = seededStore;
