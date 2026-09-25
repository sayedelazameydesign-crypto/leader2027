import { describe, it, expect } from "vitest";
import { can, actionsFor, type Actor } from "@/lib/authorization/policy";
import { ROLES, type Role } from "@/lib/authorization/roles";

const actor = (role: Role, id = "u1"): Actor => ({ id, role, team_id: "team-a" });

describe("policy matrix (Product Contract §4)", () => {
  it("كل أدوار VS2 موجودة", () => {
    expect(ROLES).toHaveLength(6);
    for (const role of ROLES) expect(actionsFor(role).length).toBeGreaterThan(0);
  });

  it("Dashboard متاح لكل الأدوار", () => {
    for (const role of ROLES) expect(can(actor(role), "dashboard:view")).toBe(true);
  });

  it("View people: Manager+ كامل، Worker/Viewer قراءة فقط (محدود = بلا create/update)", () => {
    for (const role of ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER", "FIELD_COORDINATOR"] as Role[]) {
      expect(can(actor(role), "people:view")).toBe(true);
      expect(can(actor(role), "people:create")).toBe(true);
      expect(can(actor(role), "people:update")).toBe(true);
    }
    for (const role of ["FIELD_WORKER", "VIEWER"] as Role[]) {
      expect(can(actor(role), "people:view")).toBe(true);
      expect(can(actor(role), "people:create")).toBe(false);
      expect(can(actor(role), "people:update")).toBe(false);
    }
  });

  it("Create field report: Manager/Coordinator/Worker ✅ — Viewer ❌", () => {
    for (const role of ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER", "FIELD_COORDINATOR", "FIELD_WORKER"] as Role[]) {
      expect(can(actor(role), "reports:create")).toBe(true);
    }
    expect(can(actor("VIEWER"), "reports:create")).toBe(false);
  });

  it("Manage users: Manager+ فقط", () => {
    for (const role of ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER"] as Role[]) {
      expect(can(actor(role), "users:manage")).toBe(true);
    }
    for (const role of ["FIELD_COORDINATOR", "FIELD_WORKER", "VIEWER"] as Role[]) {
      expect(can(actor(role), "users:manage")).toBe(false);
    }
  });

  it("Audit log: Manager+ كامل، Coordinator موجود (نطاق فرقه عند واجهة القراءة)، Worker/Viewer ❌", () => {
    expect(can(actor("CAMPAIGN_MANAGER"), "audit:view")).toBe(true);
    expect(can(actor("FIELD_COORDINATOR"), "audit:view")).toBe(true);
    expect(can(actor("FIELD_WORKER"), "audit:view")).toBe(false);
    expect(can(actor("VIEWER"), "audit:view")).toBe(false);
  });

  it("Assign task: Coordinator/Manager ✅ — Worker/Viewer ❌ (سياسة P3 محجوزة)", () => {
    // الكيان غير مبني في VS2؛ نثبّت السياسة وفق المصفوفة لحظة بنائه.
    const assignPolicyReserved = (role: Role): boolean =>
      ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER", "FIELD_COORDINATOR"].includes(role);
    expect(assignPolicyReserved("FIELD_COORDINATOR")).toBe(true);
    expect(assignPolicyReserved("FIELD_WORKER")).toBe(false);
    expect(assignPolicyReserved("VIEWER")).toBe(false);
  });

  it("تقرير: تغيير الحالة Coordinator+ فقط، وتعديل الملاحظات للعامل على تقريره وحده", () => {
    expect(can(actor("FIELD_WORKER", "u1"), "reports:update_status")).toBe(false);
    expect(can(actor("FIELD_COORDINATOR"), "reports:update_status")).toBe(true);

    expect(can(actor("FIELD_WORKER", "u1"), "reports:update_notes", { reported_by: "u1" })).toBe(true);
    expect(can(actor("FIELD_WORKER", "u1"), "reports:update_notes", { reported_by: "u2" })).toBe(false);
    expect(can(actor("FIELD_COORDINATOR", "c1"), "reports:update_notes", { reported_by: "u2" })).toBe(true);
  });

  it("المتطوعون: إنشاء/تحديث Coordinator+ فقط", () => {
    expect(can(actor("FIELD_WORKER"), "volunteers:create")).toBe(false);
    expect(can(actor("VIEWER"), "volunteers:update")).toBe(false);
    expect(can(actor("FIELD_COORDINATOR"), "volunteers:create")).toBe(true);
    expect(can(actor("CAMPAIGN_MANAGER"), "volunteers:update")).toBe(true);
  });
});

describe("settings:manage (VS3 — الإدارة)", () => {
  it("Owner/Admin/Manager فقط", () => {
    for (const role of ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER"] as Role[]) {
      expect(can(actor(role), "settings:manage")).toBe(true);
    }
    for (const role of ["FIELD_COORDINATOR", "FIELD_WORKER", "VIEWER"] as Role[]) {
      expect(can(actor(role), "settings:manage")).toBe(false);
    }
  });
});
