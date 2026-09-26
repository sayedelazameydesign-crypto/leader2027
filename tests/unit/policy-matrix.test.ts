/**
 * Authorization Correctness (PR #8) — مصفوفة التفويض الكاملة كاختبار حتمي.
 *
 * مصدر العقد: `project.manifest.json` (‏6 أدوار × 14 إجراءً = 84 حالة).
 * الـmanifest مُثبت التطابق مع `MATRIX` في الكود إجراءً بإجراء بواسطة
 * `npm run readme:drift` (check-manifest-drift.mjs:98-114) — إذن هذا الاختبار
 * ليس دائريًا: الـmanifest = العقد، `can()` = التنفيذ، والاختبار = الجسر السلوكي.
 *
 * ويغلق نتيجتي line الأساس:
 *   F-01a — fail-open عند غياب/تلف سياق الملكية (`reported_by`)
 *   F-01b — `TypeError` بدل المنع عندما يطابق الدور اسمًا في `Object.prototype`
 */
import { describe, it, expect } from "vitest";
import manifest from "../../project.manifest.json";
import { can, actionsFor, type Action, type Actor } from "@/lib/authorization/policy";
import { ROLES, type Role } from "@/lib/authorization/roles";

const CONTRACT_MATRIX = manifest.matrix as Record<string, string[]>;
const CONTRACT_ACTIONS = (manifest.actions as { id: string }[]).map((a) => a.id);

const actor = (role: string, id = "u1"): Actor =>
  ({ id, role, team_id: "team-a" }) as Actor;

describe("مصفوفة التفويض الكاملة — 6 أدوار × 14 إجراءً = 84 حالة", () => {
  it("العقد نفسه سليم: 6 أدوار، 14 إجراءً، وكل دور له صف", () => {
    expect(ROLES).toHaveLength(6);
    expect(CONTRACT_ACTIONS).toHaveLength(14);
    expect(Object.keys(CONTRACT_MATRIX).sort()).toEqual([...ROLES].sort());
  });

  it("كل زوج (دور × إجراء) مطابق للعقد — allow وdeny معًا", () => {
    // الزوج الوحيد الذي يعتمد على سياق المورد هو FIELD_WORKER × reports:update_notes
    // (قاعدة الملكية) — لذا يُقاس هنا بموردٍ مُرضٍ، ويُقاس سلوك غياب المورد في
    // كتلة F-01a أدناه.
    const resourceFor = (role: string, action: string) =>
      role === "FIELD_WORKER" && action === "reports:update_notes"
        ? { reported_by: "u1" }
        : undefined;

    let checked = 0;
    for (const role of ROLES) {
      for (const action of CONTRACT_ACTIONS) {
        const expected = CONTRACT_MATRIX[role].includes(action);
        expect(
          can(actor(role), action as Action, resourceFor(role, action)),
          `${role} × ${action}`,
        ).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBe(84);
  });

  it("قاعدة الموارد محصورة بزوج واحد: الـ83 الأخرى لا تتغير بوجود مورد", () => {
    // يمنع أي توسيع/تضييق عرضي: نتيجة can() يجب ألا تعتمد على المورد إلا في
    // قاعدة ملكية ملاحظات العامل الميداني.
    // موردٌ مُطابق لهوية الممثل: وحده FIELD_WORKER × reports:update_notes يجب
    // أن يتغيّر نتيجته (deny بلا سياق ⇒ allow بمطابقة صريحة).
    const resource = { reported_by: "u1" };
    const dependent: string[] = [];
    for (const role of ROLES) {
      for (const action of CONTRACT_ACTIONS) {
        const bare = can(actor(role, "u1"), action as Action);
        const withResource = can(actor(role, "u1"), action as Action, resource);
        if (bare !== withResource) dependent.push(`${role} × ${action}`);
      }
    }
    expect(dependent).toEqual(["FIELD_WORKER × reports:update_notes"]);
  });

  it("لا توسيع عرضي للصلاحيات: صفوف actionsFor مطابقة للعقد محتوىً", () => {
    for (const role of ROLES) {
      expect([...actionsFor(role)].sort()).toEqual([...CONTRACT_MATRIX[role]].sort());
    }
  });

  it("VIEWER قراءة فقط — كل إجراء غير :view ممنوع", () => {
    const writes = CONTRACT_ACTIONS.filter((a) => !a.endsWith(":view"));
    expect(writes.length).toBeGreaterThan(0);
    for (const action of writes) {
      expect(can(actor("VIEWER"), action as Action), `VIEWER × ${action}`).toBe(false);
    }
  });

  it("FIELD_WORKER لا يملك أي إجراء إداري (users/settings/audit)", () => {
    for (const action of ["users:manage", "settings:manage", "audit:view"] as Action[]) {
      expect(can(actor("FIELD_WORKER"), action)).toBe(false);
    }
  });
});

describe("F-01a — قاعدة الملكية: FIELD_WORKER + reports:update_notes", () => {
  const A = "reports:update_notes" as Action;

  it("مطابقة صريحة للملكية ⇒ ALLOW", () => {
    expect(can(actor("FIELD_WORKER", "u1"), A, { reported_by: "u1" })).toBe(true);
  });

  it("ملكية عائدة لممثل آخر ⇒ DENY", () => {
    expect(can(actor("FIELD_WORKER", "u1"), A, { reported_by: "u2" })).toBe(false);
  });

  it("المورد محذوف entirely ⇒ DENY (fail-closed)", () => {
    expect(can(actor("FIELD_WORKER", "u1"), A)).toBe(false);
    expect(can(actor("FIELD_WORKER", "u1"), A, undefined)).toBe(false);
  });

  it("مورد موجود و reported_by ناقص ⇒ DENY", () => {
    expect(can(actor("FIELD_WORKER", "u1"), A, { reported_by: undefined })).toBe(false);
    expect(can(actor("FIELD_WORKER", "u1"), A, {})).toBe(false);
  });

  it("ملكية تالفة (null / نص فارغ / رقم / كائن / مصفوفة / منطقي) ⇒ DENY", () => {
    const malformed = [null, "", 123, {}, [], ["u1"], true, NaN];
    for (const bad of malformed) {
      expect(
        can(actor("FIELD_WORKER", "u1"), A, { reported_by: bad as unknown as string }),
        `reported_by=${JSON.stringify(bad)}`,
      ).toBe(false);
    }
  });

  it("هوية ممثل تالفة (id ناقص / فارغ / غير نصي) ⇒ DENY", () => {
    expect(can({ role: "FIELD_WORKER" } as unknown as Actor, A, { reported_by: "u1" })).toBe(false);
    expect(can({ role: "FIELD_WORKER" } as unknown as Actor, A, {})).toBe(false);
    expect(can({ id: "", role: "FIELD_WORKER" } as Actor, A, { reported_by: "" })).toBe(false);
    expect(
      can(
        { id: 7, role: "FIELD_WORKER" } as unknown as Actor,
        A,
        { reported_by: 7 as unknown as string },
      ),
    ).toBe(false);
  });

  it("لا تغيير في دلالات الأدوار الأخرى (القاعدة محصورة بـFIELD_WORKER)", () => {
    for (const role of ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER", "FIELD_COORDINATOR"]) {
      expect(can(actor(role, "c1"), A), role).toBe(true); // بلا مورد — كما قبل الإصلاح
      expect(can(actor(role, "c1"), A, {}), role).toBe(true); // مورد ناقص — كما قبل الإصلاح
      expect(can(actor(role, "c1"), A, { reported_by: "u9" }), role).toBe(true);
      expect(can(actor(role, "c1"), A, { reported_by: null as unknown as string }), role).toBe(true);
    }
  });

  it("reports:update_status لا يتأثر بقاعدة الملكية (Coordinator+ فقط، والعامل ممنوع)", () => {
    expect(can(actor("FIELD_WORKER", "u1"), "reports:update_status")).toBe(false);
    expect(can(actor("FIELD_WORKER", "u1"), "reports:update_status", { reported_by: "u1" })).toBe(false);
    expect(can(actor("FIELD_COORDINATOR", "c1"), "reports:update_status")).toBe(true);
  });
});

describe("F-01b — دور/ممثل غير صالح ⇒ منع افتراضي صريح، لا استثناء", () => {
  const PROTOTYPE_ROLES = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "__proto__",
    "__defineGetter__",
  ];

  it("أدوار بأسماء Object.prototype ⇒ false بلا رمي (كانت TypeError)", () => {
    for (const role of PROTOTYPE_ROLES) {
      expect(() => can(actor(role), "dashboard:view"), role).not.toThrow();
      expect(can(actor(role), "dashboard:view"), role).toBe(false);
      expect(can(actor(role), "reports:update_notes", { reported_by: "u2" }), role).toBe(false);
      expect(() => actionsFor(role as Role), role).not.toThrow();
      expect(actionsFor(role as Role), role).toEqual([]);
    }
  });

  it("أدوار غير معروفة عادية ⇒ false (بلا تغيير عن السلوك السابق)", () => {
    for (const role of ["ADMIN", "owner", "Viewer", "", "FIELD_WORKER ", "UNKNOWN", "AGENT", "SYSTEM"]) {
      expect(can(actor(role), "dashboard:view"), `"${role}"`).toBe(false);
    }
  });

  it("ممثل تالف (null / undefined / بلا دور / دور غير نصي) ⇒ false بلا رمي", () => {
    const broken = [null, undefined, {}, { id: "u1" }, { id: "u1", role: 7 }, { id: "u1", role: null }];
    for (const bad of broken) {
      expect(() => can(bad as unknown as Actor, "dashboard:view")).not.toThrow();
      expect(can(bad as unknown as Actor, "dashboard:view")).toBe(false);
    }
  });

  it("الثابت الموثّق في النواة: دور غير معروف ⇒ لا صلاحية لأي إجراء من الـ14", () => {
    for (const action of CONTRACT_ACTIONS) {
      expect(can(actor("UNKNOWN"), action as Action), action).toBe(false);
    }
    expect(actionsFor("UNKNOWN" as Role)).toEqual([]);
  });
});
