/**
 * اختبارات عقود النواة — التحقق، المَقابض، توافق الاستبدال، الناقل، الموافقات.
 * هذه وحدة نقية: صفر مخزن، صفر شبكة.
 */
import { describe, it, expect } from "vitest";
import {
  KernelContractError,
  RISK_ORDER,
  defineCell,
  type Cell,
} from "@/lib/kernel/types";
import { highestRisk, resolveConfig, assertSwappable, validateCell } from "@/lib/kernel/manifest";
import { EventBus } from "@/lib/kernel/bus";
import { ApprovalGate } from "@/lib/kernel/approvals";

/* ------------------------------------------------------------ عون الاختبار */

function makeCell(overrides: Partial<Cell["manifest"]> = {}, extras: Partial<Cell> = {}): Cell {
  const manifest = {
    id: "demo",
    version: "1.0.0",
    title: { ar: "نواة تجريبية", en: "Demo nucleus" },
    corner: "اختبار",
    summary: { ar: "ملخص", en: "Summary" },
    provides: ["demo.read"],
    requires: [],
    emits: ["demo.happened"],
    consumes: [],
    config: [
      {
        key: "limit",
        label: { ar: "حد", en: "Limit" },
        default: 10,
        effect: { ar: "أثر", en: "Effect" },
      },
    ],
    tools: [
      {
        name: "demo.list",
        label: { ar: "قائمة", en: "List" },
        capability: "demo.read",
        risk: "read" as const,
        input: {},
        requiresApprovalForAgents: false,
      },
    ],
    ...overrides,
  } satisfies Cell["manifest"];

  return defineCell({
    manifest,
    services: { "demo.read": { list: () => [] } },
    tools: { "demo.list": () => ({ ok: true }) },
    ...extras,
  });
}

/* ------------------------------------------------------- تحقق العقود */

describe("kernel/manifest: validateCell", () => {
  it("يقبل خلية سليمة", () => {
    expect(() => validateCell(makeCell())).not.toThrow();
  });

  it("يرفض معرّفًا غير صالح", () => {
    expect(() => validateCell(makeCell({ id: "Demo Cell" }))).toThrow(KernelContractError);
  });

  it("يرفض نسخة غير semver", () => {
    expect(() => validateCell(makeCell({ version: "v1" }))).toThrow(/semver/);
  });

  it("يرفض عنوانًا بلا ترجمة إنجليزية", () => {
    expect(() =>
      validateCell(makeCell({ title: { ar: "عربي" } as unknown as Cell["manifest"]["title"] })),
    ).toThrow(/ثنائي اللغة/);
  });

  it("يرفض قدرة بصيغة خاطئة", () => {
    expect(() => validateCell(makeCell({ provides: ["demo"] }))).toThrow(/namespace\.action/);
  });

  it("يرفض قدرة مُعلَنة بلا خدمة (لا قدرة وهمية)", () => {
    const cell = makeCell();
    delete (cell as { services?: unknown }).services;
    expect(() => validateCell(cell)).toThrow(/بلا خدمة/);
  });

  it("يرفض خدمة غير مُعلَنة في provides", () => {
    const cell = makeCell();
    (cell.services as Record<string, unknown>)["demo.secret"] = {};
    expect(() => validateCell(cell)).toThrow(/غير مُعلَنة في provides/);
  });

  it("يرفض أداة خارج نطاق اسم نواتها", () => {
    expect(() =>
      validateCell(
        makeCell({
          tools: [
            {
              name: "other.list",
              label: { ar: "ق", en: "L" },
              capability: "demo.read",
              risk: "read",
              input: {},
              requiresApprovalForAgents: false,
            },
          ],
        }),
      ),
    ).toThrow(/يجب أن يبدأ/);
  });

  it("يرفض أداة تستدعي قدرة غير مُعلَنة", () => {
    expect(() =>
      validateCell(
        makeCell({
          tools: [
            {
              name: "demo.list",
              label: { ar: "ق", en: "L" },
              capability: "demo.write",
              risk: "read",
              input: {},
              requiresApprovalForAgents: false,
            },
          ],
        }),
      ),
    ).toThrow(/غير مُعلَنة في provides/);
  });

  it("يرفض أداة كتابة لا تتطلب موافقة الوكيل (بوابة 2027)", () => {
    expect(() =>
      validateCell(
        makeCell({
          tools: [
            {
              name: "demo.list",
              label: { ar: "ق", en: "L" },
              capability: "demo.read",
              risk: "write",
              input: {},
              requiresApprovalForAgents: false,
            },
          ],
        }),
      ),
    ).toThrow(/يجب أن تتطلب موافقة الوكيل/);
  });

  it("يرفض أداة مُعلَنة بلا مُنفِّذ", () => {
    const cell = makeCell();
    delete (cell as { tools?: unknown }).tools;
    expect(() => validateCell(cell)).toThrow(/بلا مُنفِّذ/);
  });

  it("يرفض مُنفِّذًا غير مُعلَن", () => {
    const cell = makeCell();
    (cell.tools as Record<string, unknown>)["demo.extra"] = () => 1;
    expect(() => validateCell(cell)).toThrow(/غير مُعلَن/);
  });
});

/* ----------------------------------------------------------- المَقابض */

describe("kernel/manifest: resolveConfig", () => {
  it("يعيد القيم الافتراضية مُجمَّدة", () => {
    const config = resolveConfig(makeCell().manifest);
    expect(config.limit).toBe(10);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("يطبّق التجاوزات المُعلَنة فقط", () => {
    const config = resolveConfig(makeCell().manifest, { limit: 5 });
    expect(config.limit).toBe(5);
  });

  it("يرفض مَقبضًا غير مُعلَن — لا تعديل من خارج العقد", () => {
    expect(() => resolveConfig(makeCell().manifest, { other: 1 })).toThrow(/غير مُعلَن/);
  });

  it("يرفض نوعًا مختلفًا عن المُعلَن", () => {
    expect(() => resolveConfig(makeCell().manifest, { limit: "5" })).toThrow(/النوع المتوقع/);
  });
});

/* -------------------------------------------------- الاستبدال الساخن */

describe("kernel/manifest: assertSwappable", () => {
  const base = makeCell().manifest;

  it("يقبل نسخة أحدث تُشبع نفس القدرات", () => {
    expect(() => assertSwappable(base, makeCell({ version: "1.1.0" }).manifest)).not.toThrow();
  });

  it("يقبل توسيع القدرات (توافق أمامي)", () => {
    const next = makeCell({ version: "1.2.0", provides: ["demo.read", "demo.extra"] });
    (next.services as Record<string, unknown>)["demo.extra"] = {};
    expect(() => assertSwappable(base, validateCell(next) ?? next.manifest)).not.toThrow();
  });

  it("يرفض استبدال نواة بنواة أخرى", () => {
    expect(() => assertSwappable(base, makeCell({ id: "other" }).manifest)).toThrow(/لا يمكن استبدال/);
  });

  it("يرفض إسقاط قدرة — كسر للمُستهلكين", () => {
    const next = makeCell({ version: "1.1.0", provides: ["demo.write"] });
    (next.services as Record<string, unknown>) = { "demo.write": {} };
    expect(() => assertSwappable(base, next.manifest)).toThrow(/لا تُشبع قدرات/);
  });

  it("يرفض تغيير الرقم الرئيسي", () => {
    expect(() => assertSwappable(base, makeCell({ version: "2.0.0" }).manifest)).toThrow(/كسرٌ للعقد/);
  });

  it("يرفض التراجع في النسخة داخل نفس الرقم الرئيسي", () => {
    const older = makeCell({ version: "1.0.0" }).manifest;
    expect(() => assertSwappable(makeCell({ version: "1.2.0" }).manifest, older)).toThrow(/تراجع نسخة/);
  });

  it("التراجع عبر الرقم الرئيسي يُرفض أولًا ككسر عقد", () => {
    const older = makeCell({ version: "0.9.0" }).manifest;
    expect(() => assertSwappable(makeCell({ version: "1.2.0" }).manifest, older)).toThrow(/كسرٌ للعقد/);
  });
});

describe("kernel/manifest: highestRisk", () => {
  it("يرجع أعلى مستوى", () => {
    expect(highestRisk(["read", "write"])).toBe("write");
    expect(highestRisk(["read", "admin", "write"])).toBe("admin");
    expect(RISK_ORDER.admin).toBeGreaterThan(RISK_ORDER.write);
  });
});

/* ------------------------------------------------------------ الناقل */

describe("kernel/bus: عزل الفشل", () => {
  it("مشترِك يرمي استثناءً لا يُسقط الناشر ولا يمنع البقية", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe({ owner: "bad", types: "*", handler: () => { throw new Error("boom"); } });
    bus.subscribe({ owner: "good", types: "*", handler: (e) => { seen.push(e.type); } });

    const failed = bus.publish({ type: "demo.happened", source: "kernel", at: "t", payload: {} });

    expect(failed).toBe(1);
    expect(seen).toEqual(["demo.happened"]);
    expect(bus.failureCount).toBe(1);
  });

  it("مشترِك غير متزامن فاشل لا يُسقط الناشر", async () => {
    const bus = new EventBus();
    bus.subscribe({ owner: "async", types: "*", handler: async () => { throw new Error("later"); } });
    bus.publish({ type: "demo.happened", source: "kernel", at: "t", payload: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(bus.failureCount).toBe(1);
  });

  it("لا يُسلَّم الحدث لغير المُشترك في نوعه", () => {
    const bus = new EventBus();
    let hits = 0;
    bus.subscribe({ owner: "a", types: ["other.event"], handler: () => { hits += 1; } });
    bus.publish({ type: "demo.happened", source: "kernel", at: "t", payload: {} });
    expect(hits).toBe(0);
  });

  it("إلغاء الاشتراك يوقف التسليم", () => {
    const bus = new EventBus();
    let hits = 0;
    const off = bus.subscribe({ owner: "a", types: "*", handler: () => { hits += 1; } });
    bus.publish({ type: "demo.happened", source: "kernel", at: "t", payload: {} });
    off();
    bus.publish({ type: "demo.happened", source: "kernel", at: "t", payload: {} });
    expect(hits).toBe(1);
    expect(bus.subscriberCount).toBe(0);
  });

  it("يُسجّل حدث فشل المشترك للتشخيص", () => {
    const bus = new EventBus();
    bus.subscribe({ owner: "bad", types: "*", handler: () => { throw new Error("x"); } });
    bus.publish({ type: "demo.happened", source: "kernel", at: "t", payload: {} });
    const types = bus.recent(10).map((e) => e.type);
    expect(types).toContain("kernel.subscriber.failed");
  });
});

/* -------------------------------------------------------- الموافقات */

describe("kernel/approvals: بوابة بشرية", () => {
  const ttl = 60_000;

  it("ينشئ طلبًا معلَّقًا ويظهر في pending", () => {
    const gate = new ApprovalGate({ ttlMs: ttl });
    const req = gate.request({ cell: "people", tool: "people.create", actor: "agent-1", reason: "سبب", payload: {} });
    expect(req.state).toBe("pending");
    expect(gate.pending()).toHaveLength(1);
  });

  it("المنح يسمح بالاستهلاك مرة واحدة فقط", () => {
    const gate = new ApprovalGate({ ttlMs: ttl });
    const req = gate.request({ cell: "people", tool: "people.create", actor: "agent-1", reason: "r", payload: {} });
    gate.grant(req, "user-manager");
    expect(gate.consume(req.id)?.state).toBe("consumed");
    expect(gate.consume(req.id)).toBeNull();
  });

  it("الرفض يمنع الاستهلاك", () => {
    const gate = new ApprovalGate({ ttlMs: ttl });
    const req = gate.request({ cell: "people", tool: "people.create", actor: "agent-1", reason: "r", payload: {} });
    gate.deny(req, "user-manager", "غير مبرَّر");
    expect(gate.consume(req.id)).toBeNull();
    expect(gate.get(req.id)?.state).toBe("denied");
  });

  it("لا تراجع صامت عن قرار محسوم", () => {
    const gate = new ApprovalGate({ ttlMs: ttl });
    const req = gate.request({ cell: "people", tool: "people.create", actor: "agent-1", reason: "r", payload: {} });
    gate.grant(req, "user-manager");
    expect(() => gate.deny(req, "user-owner", "تراجع")).toThrow(/محسوم بالفعل/);
  });

  it("الطلب المنتهي لا يُمنح ولا يُستهلك", () => {
    let clock = 1_000_000;
    const gate = new ApprovalGate({ ttlMs: 1000, now: () => clock });
    const req = gate.request({ cell: "people", tool: "people.create", actor: "agent-1", reason: "r", payload: {} });
    clock += 5000;
    expect(gate.get(req.id)?.state).toBe("expired");
    expect(gate.consume(req.id)).toBeNull();
  });

  it("يرفض قرارًا على طلب غير موجود", () => {
    const gate = new ApprovalGate({ ttlMs: ttl });
    const ghost = { id: "nope" } as never;
    expect(() => gate.grant(ghost, "user-owner")).toThrow(/غير موجود/);
  });
});
