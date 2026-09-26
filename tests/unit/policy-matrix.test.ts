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

/**
 * D-01 — عقد الممثل (Actor contract) · القرار المعتمد: **OPTION B**
 *
 *   - `id` ليس شرطًا عامًا لكل قرار تفويض؛ يُشترط فقط حيث تتطلب القاعدة هوية/ملكية.
 *   - لا validation عام لـ`actor.id` · لا تغيير في نتائج 6×14 · لا عزل فرق (team isolation).
 *
 * الأدلة العقدية: مصفوفة §4 (`project.manifest.json.matrix`) بُعداها دور × إجراء بلا بُعد هوية؛
 * `lib/kernel/bridge.ts:16-25` و`docs/kernel.md` §3/5 («دور مجهول ⇒ رفض افتراضي») يجعلان **الدور**
 * مفتاح القرار؛ و`lib/kernel/kernel.ts:629-632` يُسقط الهوية احتياطيًا (`decidedBy ?? actor.id`)
 * بينما الدور المجهول يصبح `"UNKNOWN"` ⇒ منع. القاعدة الوحيدة التي تستهلك `actor.id` هي ملكية
 * `reports:update_notes` للعامل الميداني (`lib/domain/field/service.ts:85`).
 *
 * هذه الاختبارات الأربعة تُثبّت **القرار نفسه** ضد تراجع مستقبلي في الاتجاهين:
 * لا توسيع (منح بلا هوية حيث تلزم) ولا تضييق (منع عام لغياب الهوية أو لاختلاف الفريق).
 */
describe("D-01 — عقد الممثل: OPTION B (الهوية شرط في قاعدة الملكية وحدها)", () => {
  const OWN = "reports:update_notes" as Action;
  const OWNERSHIP_PAIR = "FIELD_WORKER × reports:update_notes";
  const NO_ID_SHAPES: Array<[string, Partial<Actor>]> = [
    ["id غائب", {}],
    ["id فارغ", { id: "" }],
    ["id غير نصي (رقم)", { id: 7 as unknown as string }],
    ["id null", { id: null as unknown as string }],
  ];

  it("D-01/1 — `id` ليس شرطًا عامًا: ممثل بلا هوية بدور صالح يطابق العقد في 83 زوجًا ويُمنع في زوج الملكية وحده", () => {
    for (const [shape, partial] of NO_ID_SHAPES) {
      const dependent: string[] = [];
      let checked = 0;
      for (const role of ROLES) {
        for (const action of CONTRACT_ACTIONS) {
          const pair = `${role} × ${action}`;
          const withResource = pair === OWNERSHIP_PAIR ? { reported_by: "u1" } : undefined;
          const idless = { ...partial, role, team_id: "team-a" } as Actor;
          const got = can(idless, action as Action, withResource);
          const expected = CONTRACT_MATRIX[role].includes(action);
          if (pair === OWNERSHIP_PAIR) {
            // القاعدة تتطلب هوية ⇒ غيابها/تلفها = منع حتى مع مورد يحمل مالكًا.
            expect(got, `${shape}: ${pair}`).toBe(false);
            dependent.push(pair);
          } else {
            // خارج قاعدة الملكية: نتيجة المصفوفة كما هي — لا منع عام لغياب الهوية.
            expect(got, `${shape}: ${pair}`).toBe(expected);
          }
          checked += 1;
        }
      }
      expect(checked, shape).toBe(84);
      expect(dependent, shape).toEqual([OWNERSHIP_PAIR]);
    }
  });

  it("D-01/2 — الهوية تُشترط في قاعدة الملكية فقط: لا مساواة عرضية (undefined/''/7/null) — والمنح بمطابقة صريحة", () => {
    // كانت هذه الحالات الأربع تُعيد true قبل PR #8 (fail-open عبر `reported_by !== undefined` أو مساواة تافهة).
    expect(can({ role: "FIELD_WORKER" } as Actor, OWN, { reported_by: undefined })).toBe(false);
    expect(can({ role: "FIELD_WORKER" } as Actor, OWN)).toBe(false);
    expect(can({ id: "", role: "FIELD_WORKER" } as Actor, OWN, { reported_by: "" })).toBe(false);
    expect(
      can({ id: 7, role: "FIELD_WORKER" } as unknown as Actor, OWN, { reported_by: 7 as unknown as string }),
    ).toBe(false);
    expect(
      can({ id: null, role: "FIELD_WORKER" } as unknown as Actor, OWN, { reported_by: null as unknown as string }),
    ).toBe(false);
    // الهوية الصحيحة مع مالك مطابق هي الطريق الوحيد للمنح.
    expect(can(actor("FIELD_WORKER", "u1"), OWN, { reported_by: "u1" })).toBe(true);
    expect(can(actor("FIELD_WORKER", "u1"), OWN, { reported_by: "u2" })).toBe(false);
  });

  it("D-01/3 — نطاق القاعدة FIELD_WORKER وحده: الأدوار الأخرى لا تحتاج هوية لـreports:update_notes", () => {
    for (const role of ["OWNER", "CAMPAIGN_ADMIN", "CAMPAIGN_MANAGER", "FIELD_COORDINATOR"]) {
      for (const [shape, partial] of NO_ID_SHAPES) {
        const idless = { ...partial, role } as Actor;
        expect(can(idless, OWN), `${role} (${shape}) بلا مورد`).toBe(true);
        expect(can(idless, OWN, {}), `${role} (${shape}) مورد بلا مالك`).toBe(true);
        expect(can(idless, OWN, { reported_by: "u9" }), `${role} (${shape}) مالك آخر`).toBe(true);
      }
    }
    // VIEWER ممنوع بالمصفوفة لا بالهوية: الهوية الصحيحة والمورد المطابق لا يمنحانه شيئًا.
    expect(can(actor("VIEWER", "u1"), OWN, { reported_by: "u1" })).toBe(false);
  });

  it("D-01/4 — لا عزل فرق: team_id للممثل والمورد لا يغيّر أيًا من نتائج الـ84 (F-02 يبقى قرارًا مؤجلًا)", () => {
    let checked = 0;
    for (const role of ROLES) {
      for (const action of CONTRACT_ACTIONS) {
        const same = can(
          { id: "u1", role, team_id: "team-a" } as Actor,
          action as Action,
          { reported_by: "u1", team_id: "team-a" },
        );
        const cross = can(
          { id: "u1", role, team_id: "team-a" } as Actor,
          action as Action,
          { reported_by: "u1", team_id: "team-b" },
        );
        const noTeam = can({ id: "u1", role, team_id: null } as Actor, action as Action, { reported_by: "u1" });
        expect(cross, `${role} × ${action} (فريق مختلف)`).toBe(same);
        expect(noTeam, `${role} × ${action} (بلا فريق)`).toBe(same);
        checked += 1;
      }
    }
    expect(checked).toBe(84);
  });
});
