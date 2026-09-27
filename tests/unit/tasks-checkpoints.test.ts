/**
 * GEN-3 — اختبارات التجزئة وسلامة السلسلة (امتداد GEN-2).
 */
import { describe, it, expect } from "vitest";
import {
  canonicalize,
  sha256hex,
  proposalHash,
  checkpointHash,
  evidenceHash,
  CHECKPOINT_GENESIS,
  EVIDENCE_GENESIS,
} from "@/lib/tasks/hashing";
import { createMemoryRepos, emptyStore, reposFromStore } from "@/lib/persistence/memory";
import { TaskEngine } from "@/lib/tasks/engine";

describe("tasks-hashing: الحتمية", () => {
  it("canonicalize لا يتأثر بترتيب المفاتيح (بعمق كامل)", () => {
    const a = { z: 1, a: { d: [3, 2], b: "x" } };
    const b = { a: { b: "x", d: [3, 2] }, z: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("proposalHash ثابت لنفس المقترح وحساس لأي تغيير", () => {
    const p1 = { operation: "NEXA_A_PAID", costCap: 50, args: { q: 1 } };
    const p2 = { args: { q: 1 }, costCap: 50, operation: "NEXA_A_PAID" };
    expect(proposalHash(p1)).toBe(proposalHash(p2));
    expect(proposalHash({ ...p1, costCap: 51 })).not.toBe(proposalHash(p1));
    expect(proposalHash(p1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("checkpointHash يتغير مع أي حقل", () => {
    const base = {
      prevHash: CHECKPOINT_GENESIS,
      taskId: "t1",
      seq: 0,
      state: "CREATED" as const,
      stepId: null,
      context: {},
      evidenceHead: EVIDENCE_GENESIS,
      at: "2026-09-27T00:00:00.000Z",
    };
    const h = checkpointHash(base);
    expect(checkpointHash({ ...base, seq: 1 })).not.toBe(h);
    expect(checkpointHash({ ...base, state: "READY" })).not.toBe(h);
    expect(checkpointHash({ ...base, context: { x: 1 } })).not.toBe(h);
    expect(sha256hex("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("evidenceHash سلسلة — الرأس الجديد يعتمد السابق", () => {
    const h1 = evidenceHash(EVIDENCE_GENESIS, "s1", { ok: true });
    const h2 = evidenceHash(h1, "s2", { ok: true });
    expect(h1).not.toBe(h2);
    expect(evidenceHash(EVIDENCE_GENESIS, "s1", { ok: false })).not.toBe(h1);
  });
});

describe("tasks-checkpoints: السلسلة عبر المحرك", () => {
  it("الإنشاء يلحق checkpoint التكوين مربوطًا بالجذر", () => {
    const engine = new TaskEngine(createMemoryRepos());
    const task = engine.createTask("هدف");
    const cps = engine.checkpoints(task.id);
    expect(cps).toHaveLength(1);
    expect(cps[0].seq).toBe(0);
    expect(cps[0].prevHash).toBe(CHECKPOINT_GENESIS);
    expect(cps[0].state).toBe("CREATED");
    expect(task.checkpointHead).toBe(cps[0].hash);
    expect(engine.verifyChain(task.id)).toBe(true);
  });

  it("كل انتقال يمدّد السلسلة والرأس يتبع", () => {
    const engine = new TaskEngine(createMemoryRepos());
    const task = engine.createTask("هدف");
    engine.understand(task.id, { brief: "b" });
    engine.plan(task.id, [{ id: "s1", operation: "collect", costCap: 0 }]);
    const cps = engine.checkpoints(task.id);
    expect(cps.map((c) => c.state)).toEqual(["CREATED", "UNDERSTANDING", "PLANNING"]);
    expect(cps.map((c) => c.seq)).toEqual([0, 1, 2]);
    for (let i = 1; i < cps.length; i += 1) {
      expect(cps[i].prevHash).toBe(cps[i - 1].hash);
    }
    expect(engine.getTask(task.id)!.checkpointHead).toBe(cps[2].hash);
    expect(engine.verifyChain(task.id)).toBe(true);
  });

  it("العبث بالسياق ⇒ سلسلة مكسورة", () => {
    const store = emptyStore();
    const engine = new TaskEngine(reposFromStore(store));
    const task = engine.createTask("هدف");
    engine.understand(task.id, { brief: "أصلي" });
    expect(engine.verifyChain(task.id)).toBe(true);
    store.taskCheckpoints[1].context = { brief: "مزوَّر" };
    expect(engine.verifyChain(task.id)).toBe(false);
  });

  it("حذف checkpoint أوسط ⇒ سلسلة مكسورة (فجوة seq/وصلات)", () => {
    const store = emptyStore();
    const engine = new TaskEngine(reposFromStore(store));
    const task = engine.createTask("هدف");
    engine.understand(task.id, {});
    engine.plan(task.id, [{ id: "s1", operation: "collect", costCap: 0 }]);
    expect(engine.verifyChain(task.id)).toBe(true);
    store.taskCheckpoints.splice(1, 1);
    expect(engine.verifyChain(task.id)).toBe(false);
  });

  it("العبث بالرأس وحده ⇒ مكسورة", () => {
    const store = emptyStore();
    const engine = new TaskEngine(reposFromStore(store));
    const task = engine.createTask("هدف");
    expect(engine.verifyChain(task.id)).toBe(true);
    store.tasks[0].checkpointHead = "f".repeat(64);
    expect(engine.verifyChain(task.id)).toBe(false);
  });

  it("replay يعيد بناء السياق (الأحدث يغلب) والحالة المسجَّلة", () => {
    const engine = new TaskEngine(createMemoryRepos());
    const task = engine.createTask("هدفي");
    engine.understand(task.id, { summary: "موجز" });
    const rep = engine.replay(task.id);
    expect(rep.valid).toBe(true);
    expect(rep.state).toBe("UNDERSTANDING");
    expect(rep.checkpoints).toBe(2);
    expect(rep.context).toMatchObject({ goal: "هدفي", brief: { summary: "موجز" } });
  });
});
