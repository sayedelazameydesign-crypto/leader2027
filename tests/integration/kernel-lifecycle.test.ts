/**
 * اختبارات دورة حياة النواة الحيّة — على نوى حقيقية ومخزن حقيقي (in-memory).
 *
 * تُثبت الدعاوى الأساسية:
 *  1. الإقلاع: كل الأركان تُركَّب وتُشبع قدراتها.
 *  2. العزل: نواة معطوبة تُصبح degraded/blocked ولا تُسقط النظام.
 *  3. الوصول بالقدرات: لا استيراد بين الأنوية (التحقق عبر الكود في readme:drift + هنا سلوكيًا).
 *  4. الحيوية: حدث ⇒ إبطال ذاكرة المؤشرات ⇒ إعادة حساب تلقائية.
 *  5. بوابة 2027: وكيل لا يكتب بلا موافقة بشرية، والتصريح مرة واحدة.
 *  6. الاستبدال الساخن: نسخة جديدة تحلّ محل القديمة بلا فقدان الإعدادات ولا إعادة تشغيل.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos } from "@/lib/repositories/container";
import { bootKernel } from "@/lib/kernel/registry";
import { Kernel, SYSTEM_ACTOR } from "@/lib/kernel/kernel";
import { defineCell, type Actor, type Cell } from "@/lib/kernel/types";

const human = (role: string, id = `user-${role.toLowerCase()}`): Actor => ({ id, role, kind: "human" });
const agent: Actor = { id: "agent-1", role: "AGENT", kind: "agent" };

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

/* ------------------------------------------------------------------ إقلاع */

describe("kernel: الإقلاع والتركيب", () => {
  it("يركّب كل أركان النظام ويُشبع كل قدراتها", async () => {
    const boot = await bootKernel();
    try {
      expect(boot.blocked).toEqual([]);
      expect(boot.degraded).toEqual([]);
      const ids = boot.kernel.list().map((c) => c.id).sort();
      expect(ids).toEqual(
        ["ai", "audit", "auth", "field", "people", "reporting", "settings", "volunteers"].sort(),
      );
      for (const cell of boot.kernel.list()) {
        expect(cell.state).toBe("active");
        for (const capability of cell.provides) {
          expect(boot.kernel.has(capability)).toBe(true);
        }
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("كل أداة مُعلَنة لها مسار قابل للنداء", async () => {
    const boot = await bootKernel();
    try {
      const tools = boot.kernel.tools();
      expect(tools.length).toBeGreaterThanOrEqual(20);
      for (const tool of tools) {
        expect(tool.name.startsWith(`${tool.name.split(".")[0]}.`)).toBe(true);
        // الوكلاء لا يرون أداة كتابة بلا بوابة موافقة
        if (tool.risk !== "read") expect(tool.requiresApprovalForAgents).toBe(true);
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("الإقلاع مرتين لا يتعارض — مخزن جديد لكل إقلاع", async () => {
    const a = await bootKernel();
    const b = await bootKernel();
    try {
      expect(a.kernel.list()).toHaveLength(8);
      expect(b.kernel.list()).toHaveLength(8);
    } finally {
      a.kernel.reset();
      b.kernel.reset();
    }
  });
});

/* ------------------------------------------------- العزل ومقاومة الفشل */

describe("kernel: عزل الفشل", () => {
  it("نواة تفشل صحتها تُعزل degraded وبقية النظام يظل يعمل", async () => {
    const kernel = new Kernel();
    const broken = defineCell({
      manifest: {
        id: "broken",
        version: "1.0.0",
        title: { ar: "معطوبة", en: "Broken" },
        corner: "اختبار",
        summary: { ar: "م", en: "s" },
        provides: ["broken.thing"],
        requires: [],
        emits: [],
        consumes: [],
        config: [],
        tools: [],
      },
      services: { "broken.thing": {} },
      health: () => ({ ok: false, detail: "مُتعطِّلة عمدًا", at: new Date().toISOString() }),
    });

    kernel.register(broken);
    await kernel.start();

    expect(kernel.cell("broken")?.state).toBe("degraded");
    expect(kernel.snapshot().stats.degraded).toBe(1);
    // الفشل مُسجَّل وسببُه محفوظ — لا فشل صامت
    expect(kernel.cell("broken")?.lastError).toBe("مُتعطِّلة عمدًا");
    expect(kernel.failureCount).toBe(1);
    kernel.reset();
  });

  it("استدعاء أداة في نواة معطوبة يُرفض بسبب واضح ولا يرمي", async () => {
    const kernel = new Kernel();
    const broken = defineCell({
      manifest: {
        id: "broken",
        version: "1.0.0",
        title: { ar: "معطوبة", en: "Broken" },
        corner: "اختبار",
        summary: { ar: "م", en: "s" },
        provides: ["broken.read"],
        requires: [],
        emits: [],
        consumes: [],
        config: [],
        tools: [
          {
            name: "broken.read",
            label: { ar: "قراءة", en: "Read" },
            capability: "broken.read",
            risk: "read",
            input: {},
            requiresApprovalForAgents: false,
          },
        ],
      },
      services: { "broken.read": {} },
      tools: { "broken.read": () => "لن يُنفَّذ" },
      health: () => ({ ok: false, detail: "معطوبة", at: new Date().toISOString() }),
    });
    kernel.register(broken);
    await kernel.start();

    const outcome = await kernel.execute("broken.read", {}, { actor: human("OWNER") });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.code).toBe("cell.unavailable");
      expect(outcome.message).toMatch(/degraded/);
    }
    kernel.reset();
  });

  it("نواة بمتطلَّب غير مُشبَع تُسجَّل blocked بلا إسقاط الإقلاع", async () => {
    const kernel = new Kernel();
    const orphan = defineCell({
      manifest: {
        id: "orphan",
        version: "1.0.0",
        title: { ar: "يتيمة", en: "Orphan" },
        corner: "اختبار",
        summary: { ar: "م", en: "s" },
        provides: ["orphan.read"],
        requires: ["nobody.provides_this"],
        emits: [],
        consumes: [],
        config: [],
        tools: [],
      },
      services: { "orphan.read": {} },
    });

    const state = kernel.register(orphan);
    expect(state).toBe("blocked");
    await kernel.start();
    expect(kernel.cell("orphan")?.state).toBe("blocked");
    expect(kernel.cell("orphan")?.lastError).toMatch(/غير مُشبَعة/);
    kernel.reset();
  });

  it("أداة ترمي استثناءً: الفشل يُعزى لنواتها وحدها", async () => {
    const kernel = new Kernel();
    const bomb = defineCell({
      manifest: {
        id: "bomb",
        version: "1.0.0",
        title: { ar: "قنبلة", en: "Bomb" },
        corner: "اختبار",
        summary: { ar: "م", en: "s" },
        provides: ["bomb.read"],
        requires: [],
        emits: [],
        consumes: [],
        config: [],
        tools: [
          {
            name: "bomb.boom",
            label: { ar: "انفجار", en: "Boom" },
            capability: "bomb.read",
            risk: "read",
            input: {},
            requiresApprovalForAgents: false,
          },
        ],
      },
      services: { "bomb.read": {} },
      tools: {
        "bomb.boom": () => {
          throw new Error("انفجار مُتحكَّم");
        },
      },
    });
    kernel.register(bomb);
    await kernel.start();

    const outcome = await kernel.execute("bomb.boom", {}, { actor: human("OWNER") });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.message).toBe("انفجار مُتحكَّم");
    // الخلية تظل نشطة — الاستثناء لا يقتلها
    expect(kernel.cell("bomb")?.state).toBe("active");
    kernel.reset();
  });

  it("قدرة تُشبعها نواتان ⇒ رفض صريح (لا غلبة صامتة)", async () => {
    const kernel = new Kernel();
    const mk = (id: string): Cell =>
      defineCell({
        manifest: {
          id,
          version: "1.0.0",
          title: { ar: id, en: id },
          corner: "اختبار",
          summary: { ar: "م", en: "s" },
          provides: ["same.capability"],
          requires: [],
          emits: [],
          consumes: [],
          config: [],
          tools: [],
        },
        services: { "same.capability": {} },
      });
    kernel.register(mk("first"));
    await kernel.start();
    expect(() => kernel.register(mk("second"))).toThrow(/مُشبَعة من/);
    kernel.reset();
  });

  it("لا يمكن انتزاع قدرة مدمجة من النواة", async () => {
    const kernel = new Kernel();
    const thief = defineCell({
      manifest: {
        id: "thief",
        version: "1.0.0",
        title: { ar: "سارق", en: "Thief" },
        corner: "اختبار",
        summary: { ar: "م", en: "s" },
        provides: ["kernel.registry"],
        requires: [],
        emits: [],
        consumes: [],
        config: [],
        tools: [],
      },
      services: { "kernel.registry": {} },
    });
    expect(() => kernel.register(thief)).toThrow(/مُشبَعة من/);
    kernel.reset();
  });
});

/* ------------------------------------------------ القراءة عبر القدرات */

describe("kernel: capabilities عبر النوى الحقيقية", () => {
  it("people.list يقرأ المخزن الحقيقي بصلاحية سليمة", async () => {
    const boot = await bootKernel();
    try {
      const outcome = await boot.kernel.execute("people.list", {}, { actor: human("VIEWER", "user-viewer") });
      expect(outcome.status).toBe("ok");
      if (outcome.status === "ok") {
        const value = outcome.value as { count: number };
        expect(value.count).toBe(3); // 3 أشخاص في الـseed
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("دور بلا صلاحية يُرفض برسالة صريحة لا بقائمة فارغة", async () => {
    const boot = await bootKernel();
    try {
      // VIEWER لا يملك people:create
      const outcome = await boot.kernel.execute(
        "people.create",
        { full_name: "زائر", phone: "01000000000" },
        { actor: human("VIEWER", "user-viewer") },
      );
      expect(outcome.status).toBe("error");
      if (outcome.status === "error") expect(outcome.message).toMatch(/غير مصرّح|403/);
    } finally {
      boot.kernel.reset();
    }
  });

  it("§5: حقل تفضيل سياسي يُرفض عبر النواة كما يُرفض عبر HTTP", async () => {
    const boot = await bootKernel();
    try {
      const outcome = await boot.kernel.execute(
        "people.create",
        { full_name: "أحمد", phone: "01000000001", political_score: 8 },
        { actor: human("CAMPAIGN_MANAGER", "user-manager") },
      );
      expect(outcome.status).toBe("error");
      if (outcome.status === "error") expect(outcome.message).toMatch(/§5|محظور/);
      // ولم يُنشأ شيء
      const list = await boot.kernel.execute("people.list", {}, { actor: human("VIEWER", "user-viewer") });
      if (list.status === "ok") expect((list.value as { count: number }).count).toBe(3);
    } finally {
      boot.kernel.reset();
    }
  });

  it("كل mutation عبر النواة يُنشئ حدث تدقيق (عقد المنتج)", async () => {
    const boot = await bootKernel();
    try {
      const before = boot.kernel.cell("audit");
      expect(before).not.toBeNull();

      const outcome = await boot.kernel.execute(
        "people.create",
        { full_name: "مسجَّل جديد", phone: "01099999999", region_id: "region-giza" },
        { actor: human("CAMPAIGN_MANAGER", "user-manager") },
      );
      expect(outcome.status).toBe("ok");

      // سجل التدقيق الحقيقي في المخزن
      const audit = await boot.kernel.execute("audit.list", {}, { actor: human("OWNER", "user-owner") });
      expect(audit.status).toBe("ok");
      if (audit.status === "ok") {
        const value = audit.value as { events: Array<{ action: string }> };
        expect(value.events.some((e) => e.action === "person.create")).toBe(true);
      }
    } finally {
      boot.kernel.reset();
    }
  });
});

/* ------------------------------------------------------- النواة الحيّة */

describe("kernel: الحيوية — المؤشرات تتحدّث بالحدث", () => {
  it("تعديل شخص يُبطل ذاكرة المؤشرات ⇒ إعادة حساب تلقائية", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");

      // 1) نداء أول: حساب حقيقي ثم تخزين
      const first = await boot.kernel.execute("reporting.kpis", {}, { actor: owner });
      expect(first.status).toBe("ok");
      const firstValue = first.status === "ok" ? (first.value as { people: number; cached: boolean }) : null;
      expect(firstValue?.cached).toBe(false);

      // 2) نداء ثانٍ بلا تغيير: من الذاكرة
      const second = await boot.kernel.execute("reporting.kpis", {}, { actor: owner });
      expect(second.status === "ok" && (second.value as { cached: boolean }).cached).toBe(true);

      // 3) تغيير في الركن الآخر ⇒ حدث ⇒ إبطال
      const created = await boot.kernel.execute(
        "people.create",
        { full_name: "شخص جديد", phone: "01055555555", region_id: "region-giza" },
        { actor: human("CAMPAIGN_MANAGER", "user-manager") },
      );
      expect(created.status).toBe("ok");

      // 4) النداء الثالث: أُعيد الحساب وظهر الرقم الجديد بلا أي polling
      const third = await boot.kernel.execute("reporting.kpis", {}, { actor: owner });
      expect(third.status).toBe("ok");
      if (third.status === "ok") {
        const value = third.value as { people: number; cached: boolean; stats: { recomputes: number } };
        expect(value.cached).toBe(false);
        expect(value.people).toBe((firstValue?.people ?? 0) + 1);
        expect(value.stats.recomputes).toBe(2);
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("المَقبض الرقمي يغيّر ناتج الركن بلا أي تغيير في الكود", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");

      // نُعطّل متطوعًا ليختلف «النشط» عن «الكل» فعليًا (الـseed: متطوعان نشطان)
      const off = await boot.kernel.execute(
        "volunteers.set_status",
        { id: "volunteer-1", status: "inactive" },
        { actor: human("CAMPAIGN_MANAGER", "user-manager") },
      );
      expect(off.status).toBe("ok");

      const activeOnly = await boot.kernel.execute("reporting.kpis", {}, { actor: owner });
      expect(activeOnly.status).toBe("ok");
      const activeCount = activeOnly.status === "ok" ? (activeOnly.value as { volunteers: number }).volunteers : -1;

      // مَقبض واحد: احتساب كل المتطوعين لا النشطين فقط
      boot.kernel.configure("reporting", { count_inactive_volunteers: true }, owner);
      const everyOne = await boot.kernel.execute("reporting.kpis", {}, { actor: owner });
      expect(everyOne.status).toBe("ok");
      if (everyOne.status === "ok") {
        const value = everyOne.value as { volunteers: number; cached: boolean };
        expect(value.cached).toBe(false); // تغيير المَقبض أُبطل الذاكرة
        expect(activeCount).toBe(1);
        expect(value.volunteers).toBe(2);
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("تعديل مَقبض نواة لا يمسّ إعدادات نواة أخرى (استقلال الأركان)", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");
      const peopleBefore = boot.kernel.cell("people")?.config.default_source;
      const fieldBefore = boot.kernel.cell("field")?.config.max_people_contacted;

      boot.kernel.configure("field", { max_people_contacted: 42 }, owner);

      expect(boot.kernel.cell("field")?.config.max_people_contacted).toBe(42);
      expect(boot.kernel.cell("people")?.config.default_source).toBe(peopleBefore);
      expect(boot.kernel.cell("reporting")?.config.cache_ttl_ms).toBe(5000);
      expect(fieldBefore).toBe(500);
    } finally {
      boot.kernel.reset();
    }
  });

  it("مَقبض غير مُعلَن يُرفض — لا تعديل من خارج العقد", async () => {
    const boot = await bootKernel();
    try {
      expect(() => boot.kernel.configure("people", { backdoor: true }, human("OWNER", "user-owner"))).toThrow(
        /غير مُعلَن/,
      );
    } finally {
      boot.kernel.reset();
    }
  });

  it("إعادة الضبط تُرجع المَقابض إلى الافتراضي المُعلَن", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");
      boot.kernel.configure("people", { default_source: "مصدر مخصَّص" }, owner);
      expect(boot.kernel.cell("people")?.config.default_source).toBe("مصدر مخصَّص");
      boot.kernel.resetConfig("people", owner);
      expect(boot.kernel.cell("people")?.config.default_source).toBe("ميداني");
    } finally {
      boot.kernel.reset();
    }
  });
});

/* ------------------------------------------------- بوابة 2027 للوكلاء */

describe("kernel: بوابة الموافقة البشرية للوكلاء", () => {
  it("وكيل يطلب كتابة ⇒ pending_approval ولا يُنفَّذ شيء", async () => {
    const boot = await bootKernel();
    try {
      const outcome = await boot.kernel.execute(
        "people.create",
        { full_name: "من وكيل", phone: "01077777777", region_id: "region-giza" },
        { actor: agent, reason: "استيراد قائمة" },
      );
      expect(outcome.status).toBe("pending_approval");
      if (outcome.status === "pending_approval") {
        expect(outcome.approvalId).toMatch(/^apr-/);
      }
      // لم يُنشأ الشخص
      const list = await boot.kernel.execute("people.list", {}, { actor: human("VIEWER", "user-viewer") });
      if (list.status === "ok") expect((list.value as { count: number }).count).toBe(3);
    } finally {
      boot.kernel.reset();
    }
  });

  it("بعد الموافقة البشرية يستطيع الوكيل التنفيذ — ومرة واحدة فقط", async () => {
    const boot = await bootKernel();
    try {
      const pending = await boot.kernel.execute(
        "volunteers.create",
        { person_id: "person-3", team_id: "team-a" },
        { actor: agent },
      );
      expect(pending.status).toBe("pending_approval");
      const approvalId = pending.status === "pending_approval" ? pending.approvalId : "";

      // إنسان يعتمد الطلب
      const decide = await boot.kernel.execute("ai.grant_approval", { approval_id: approvalId }, { actor: human("CAMPAIGN_MANAGER", "user-manager") });
      expect(decide.status).toBe("ok");

      // الوكيل ينفّذ بالتصريح
      const first = await boot.kernel.execute(
        "volunteers.create",
        { person_id: "person-3", team_id: "team-a" },
        { actor: agent, approvalId },
      );
      expect(first.status).toBe("ok");

      // إعادة استخدام نفس التصريح مرفوضة (single-use)
      const reuse = await boot.kernel.execute(
        "volunteers.create",
        { person_id: "person-3", team_id: "team-a" },
        { actor: agent, approvalId },
      );
      expect(reuse.status).toBe("denied");
    } finally {
      boot.kernel.reset();
    }
  });

  it("تصريح أداة أخرى لا يُقبل (ولا يُستهلك)", async () => {
    const boot = await bootKernel();
    try {
      const pending = await boot.kernel.execute("people.create", { full_name: "أحمد سالم", phone: "01011111111" }, { actor: agent });
      const approvalId = pending.status === "pending_approval" ? pending.approvalId : "";
      await boot.kernel.execute("ai.grant_approval", { approval_id: approvalId }, { actor: human("OWNER", "user-owner") });

      // نفس التصريح لكن لأداة أخرى
      const wrong = await boot.kernel.execute(
        "people.update",
        { id: "person-1", full_name: "اسم مُعدَّل" },
        { actor: agent, approvalId },
      );
      expect(wrong.status).toBe("denied");
      if (wrong.status === "denied") expect(wrong.reason).toMatch(/أداة أخرى/);

      // التصريح ما زال صالحًا لأداته الأصلية — لم يُستهلك بالرفض
      const correct = await boot.kernel.execute(
        "people.create",
        { full_name: "بدر محمد", phone: "01022222222" },
        { actor: agent, approvalId },
      );
      expect(correct.status).toBe("ok");
    } finally {
      boot.kernel.reset();
    }
  });

  it("رفض بشري يمنع التنفيذ نهائيًا", async () => {
    const boot = await bootKernel();
    try {
      const pending = await boot.kernel.execute("people.create", { full_name: "مرفوض تمامًا", phone: "01033333333" }, { actor: agent });
      const approvalId = pending.status === "pending_approval" ? pending.approvalId : "";
      await boot.kernel.execute("ai.deny_approval", { approval_id: approvalId, reason: "غير مصرّح" }, { actor: human("OWNER", "user-owner") });

      const denied = await boot.kernel.execute(
        "people.create",
        { full_name: "مرفوض تمامًا", phone: "01033333333" },
        { actor: agent, approvalId },
      );
      expect(denied.status).toBe("denied");
    } finally {
      boot.kernel.reset();
    }
  });

  it("البشر لا يمرّون ببوابة الموافقة", async () => {
    const boot = await bootKernel();
    try {
      const outcome = await boot.kernel.execute(
        "people.create",
        { full_name: "من إنسان", phone: "01044444444", region_id: "region-giza" },
        { actor: human("CAMPAIGN_MANAGER", "user-manager") },
      );
      expect(outcome.status).toBe("ok");
    } finally {
      boot.kernel.reset();
    }
  });

  it("مدير النظام يمنح الموافقات — والمُنسّق لا يملك ذلك", async () => {
    const boot = await bootKernel();
    try {
      const pending = await boot.kernel.execute("people.create", { full_name: "طارق حسن", phone: "01088888888" }, { actor: agent });
      const approvalId = pending.status === "pending_approval" ? pending.approvalId : "";

      const coordinator = await boot.kernel.execute(
        "ai.grant_approval",
        { approval_id: approvalId },
        { actor: human("FIELD_COORDINATOR", "user-coordinator") },
      );
      expect(coordinator.status).toBe("error"); // 403 من المصفوفة

      const manager = await boot.kernel.execute(
        "ai.grant_approval",
        { approval_id: approvalId },
        { actor: human("CAMPAIGN_MANAGER", "user-manager") },
      );
      expect(manager.status).toBe("ok");
    } finally {
      boot.kernel.reset();
    }
  });

  it("حمولة حساسة لا تُخزَّن في طلب الموافقة (كلمة المرور تُستبدل)", async () => {
    const boot = await bootKernel();
    try {
      const pending = await boot.kernel.execute(
        "auth.login",
        { email: "owner@leader2027.test", password: "Demo!2345" },
        { actor: agent },
      );
      expect(pending.status).toBe("pending_approval");
      if (pending.status === "pending_approval") {
        const request = boot.kernel.approvals.get(pending.approvalId);
        expect(request?.input.password).toBe("***");
      }
    } finally {
      boot.kernel.reset();
    }
  });
});

/* ---------------------------------------------------- الاستبدال الساخن */

describe("kernel: الاستبدال الساخن (تعديل ركن بلا إسقاط النظام)", () => {
  it("نسخة جديدة تحلّ محل القديمة وتحافظ على السجل والقدرات", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");
      boot.kernel.configure("reporting", { cache_ttl_ms: 123 }, owner);

      // نسخة 1.1.0 من نفس النواة: تُشبع نفس القدرة + مَقبض إضافي
      const upgraded = defineCell({
        manifest: {
          ...boot.kernel.cell("reporting")!.corner
            ? {
                id: "reporting",
                version: "1.1.0",
                title: { ar: "نواة المؤشرات (نسخة 1.1)", en: "Reporting nucleus 1.1" },
                corner: "لوحة القيادة والمؤشرات",
                summary: { ar: "نسخة محدَّثة", en: "Updated version" },
                provides: ["reporting.kpis"],
                requires: [],
                emits: ["reporting.snapshot.recomputed"],
                consumes: [],
                config: [
                  {
                    key: "cache_ttl_ms",
                    label: { ar: "صلاحية الذاكرة", en: "Cache TTL" },
                    default: 5000,
                    effect: { ar: "أثر", en: "Effect" },
                  },
                  {
                    key: "new_knob",
                    label: { ar: "مَقبض جديد", en: "New knob" },
                    default: true,
                    effect: { ar: "أثر", en: "Effect" },
                  },
                ],
                tools: [
                  {
                    name: "reporting.kpis",
                    label: { ar: "المؤشرات", en: "KPIs" },
                    capability: "reporting.kpis",
                    risk: "read" as const,
                    input: {},
                    requiresApprovalForAgents: false,
                  },
                ],
              }
            : (undefined as never),
        },
        services: {
          "reporting.kpis": {
            current: () => ({
              people: 99,
              volunteers: 0,
              reports: 0,
              peopleContacted: 0,
              volunteersPresent: 0,
              cached: false,
              computedAt: new Date().toISOString(),
              ageMs: 0,
            }),
            invalidate: () => undefined,
            stats: () => ({ invalidations: 0, recomputes: 1 }),
          },
        },
        tools: { "reporting.kpis": () => ({ swapped: true }) },
      });

      const result = await boot.kernel.replace(upgraded);
      expect(result.from).toBe("1.0.0");
      expect(result.to).toBe("1.1.0");
      expect(result.state).toBe("active");

      const cell = boot.kernel.cell("reporting");
      expect(cell?.version).toBe("1.1.0");
      expect(cell?.swaps).toBe(1);
      // الإعدادات السابقة انتقلت للمَقبض المُعلَن في النسخة الجديدة
      expect(cell?.config.cache_ttl_ms).toBe(123);
      expect(cell?.config.new_knob).toBe(true);

      // القدرة ما زالت مُشبَعة والنظام يعمل
      expect(boot.kernel.has("reporting.kpis")).toBe(true);
      const call = await boot.kernel.execute("reporting.kpis", {}, { actor: owner });
      expect(call.status).toBe("ok");
      if (call.status === "ok") expect(call.value).toEqual({ swapped: true });
    } finally {
      boot.kernel.reset();
    }
  });

  it("نسخة لا تُشبع قدرة قديمة تُرفض ويبقى النظام على حاله", async () => {
    const boot = await bootKernel();
    try {
      const sneaky = defineCell({
        manifest: {
          id: "people",
          version: "1.0.1",
          title: { ar: "أشخاص", en: "People" },
          corner: "سجل الأشخاص",
          summary: { ar: "م", en: "s" },
          provides: ["people.read"], // أسقطت people.write
          requires: [],
          emits: [],
          consumes: [],
          config: [],
          tools: [],
        },
        services: { "people.read": {} },
      });

      await expect(boot.kernel.replace(sneaky)).rejects.toThrow(/لا تُشبع قدرات/);
      // النظام لم يتأثر
      expect(boot.kernel.cell("people")?.version).toBe("1.0.0");
      expect(boot.kernel.has("people.write")).toBe(true);
    } finally {
      boot.kernel.reset();
    }
  });

  it("نسخة معطوبة (فحص صحة فاشل) لا تحلّ محل العاملة", async () => {
    const boot = await bootKernel();
    try {
      const broken = defineCell({
        manifest: {
          id: "people",
          version: "1.0.1",
          title: { ar: "أشخاص", en: "People" },
          corner: "سجل الأشخاص",
          summary: { ar: "م", en: "s" },
          provides: ["people.read", "people.write"],
          requires: [],
          emits: [],
          consumes: [],
          config: [],
          tools: [],
        },
        services: { "people.read": {}, "people.write": {} },
        health: () => ({ ok: false, detail: "لا تصل للمخزن", at: new Date().toISOString() }),
      });

      await expect(boot.kernel.replace(broken)).rejects.toThrow(/أُبقي على النسخة الحالية/);
      expect(boot.kernel.cell("people")?.version).toBe("1.0.0");
      expect(boot.kernel.cell("people")?.state).toBe("active");
    } finally {
      boot.kernel.reset();
    }
  });

  it("استبدال نواة غير مُركَّبة يُرفض", async () => {
    const boot = await bootKernel();
    try {
      const ghost = defineCell({
        manifest: {
          id: "ghost",
          version: "1.0.0",
          title: { ar: "شبح", en: "Ghost" },
          corner: "اختبار",
          summary: { ar: "م", en: "s" },
          provides: ["ghost.read"],
          requires: [],
          emits: [],
          consumes: [],
          config: [],
          tools: [],
        },
        services: { "ghost.read": {} },
      });
      await expect(boot.kernel.replace(ghost)).rejects.toThrow(/لا توجد خلية/);
    } finally {
      boot.kernel.reset();
    }
  });

  it("إلغاء تركيب نواة يجعل مستهلكيها يعملون بلا أداة (لا انهيار)", async () => {
    const boot = await bootKernel();
    try {
      expect(boot.kernel.unmount("field")).toBe(true);
      // بقية النظام يعمل
      const kpis = await boot.kernel.execute("reporting.kpis", {}, { actor: human("OWNER", "user-owner") });
      expect(["ok", "error"]).toContain(kpis.status);
      expect(boot.kernel.cell("auth")?.state).toBe("active");
    } finally {
      boot.kernel.reset();
    }
  });
});

/* ------------------------------------------------------ الكتالوج للوكلاء */

describe("kernel: كتالوج الوكلاء", () => {
  it("يسرد الأدوات مع ركن كل أداة ومستوى خطورتها", async () => {
    const boot = await bootKernel();
    try {
      const outcome = await boot.kernel.execute("ai.list_tools", {}, { actor: human("OWNER", "user-owner") });
      expect(outcome.status).toBe("ok");
      if (outcome.status === "ok") {
        const value = outcome.value as { total: number; tools: Array<{ name: string; corner: string; risk: string }> };
        expect(value.total).toBeGreaterThanOrEqual(20);
        const create = value.tools.find((t) => t.name === "people.create");
        expect(create?.corner).toBe("سجل الأشخاص");
        expect(create?.risk).toBe("write");
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("مَقبض الكتالوج يقلّص السطح لأدوات القراءة وحدها", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");
      const all = await boot.kernel.execute("ai.list_tools", {}, { actor: owner });
      const allTotal = all.status === "ok" ? (all.value as { total: number }).total : 0;

      boot.kernel.configure("ai", { include_write_tools: false }, owner);
      const readOnly = await boot.kernel.execute("ai.list_tools", {}, { actor: owner });
      expect(readOnly.status).toBe("ok");
      if (readOnly.status === "ok") {
        const value = readOnly.value as { total: number; tools: Array<{ risk: string }> };
        expect(value.total).toBeLessThan(allTotal);
        expect(value.tools.every((t) => t.risk === "read")).toBe(true);
      }
    } finally {
      boot.kernel.reset();
    }
  });

  it("مَقبض إخفاء أدوات الإدارة يعمل", async () => {
    const boot = await bootKernel();
    try {
      const owner = human("OWNER", "user-owner");
      boot.kernel.configure("ai", { hide_admin_tools: true }, owner);
      const outcome = await boot.kernel.execute("ai.list_tools", {}, { actor: owner });
      if (outcome.status === "ok") {
        const value = outcome.value as { tools: Array<{ risk: string }> };
        expect(value.tools.some((t) => t.risk === "admin")).toBe(false);
      }
    } finally {
      boot.kernel.reset();
    }
  });
});
