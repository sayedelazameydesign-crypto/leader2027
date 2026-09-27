/**
 * GEN-3 — اختبارات آلة الحالة البنيوية (لا ادعاء شرعية بلا إثبات).
 *
 * تثبّت قواعد العقد §5/R1–R6 على مستوى الحارس وحده (بلا مخزن).
 */
import { describe, it, expect } from "vitest";
import { TRANSITIONS, assertTransition, isTerminal } from "@/lib/tasks/machine";
import { TaskEngineError } from "@/lib/tasks/types";
import type { TaskStatus } from "@/lib/repositories/interfaces";

function illegal(from: TaskStatus, to: TaskStatus): string {
  try {
    assertTransition(from, to);
  } catch (err) {
    expect(err).toBeInstanceOf(TaskEngineError);
    return (err as TaskEngineError).code;
  }
  throw new Error(`expected ${from} → ${to} to be illegal`);
}

describe("tasks-machine: العمود الفقري الشرعي", () => {
  it("السلسلة الكاملة CREATED→…→COMPLETED شرعية", () => {
    const spine: TaskStatus[] = [
      "CREATED",
      "UNDERSTANDING",
      "PLANNING",
      "READY",
      "EXECUTING",
      "OBSERVING",
      "VERIFYING",
      "COMPLETED",
    ];
    for (let i = 0; i < spine.length - 1; i += 1) {
      expect(() => assertTransition(spine[i], spine[i + 1])).not.toThrow();
    }
  });

  it("حلقة الاسترداد VERIFYING→RECOVERING→REPLANNING→READY شرعية", () => {
    expect(() => assertTransition("VERIFYING", "RECOVERING")).not.toThrow();
    expect(() => assertTransition("RECOVERING", "REPLANNING")).not.toThrow();
    expect(() => assertTransition("REPLANNING", "READY")).not.toThrow();
  });

  it("حلقة الخطوات: OBSERVING→READY (بقيت خطوات) وOBSERVING→VERIFYING (اكتملت)", () => {
    expect(() => assertTransition("OBSERVING", "READY")).not.toThrow();
    expect(() => assertTransition("OBSERVING", "VERIFYING")).not.toThrow();
    // لا قفز للتنفيذ مباشرة — المرور بـREADY يُبقي طلب الموافقة mid-plan شرعيًا (R1)
    expect(illegal("OBSERVING", "EXECUTING")).toBe("task.transition.illegal");
  });

  it("صياغة الخطة REPLANNING→REPLANNING شرعية (checkpointed refinement)", () => {
    expect(() => assertTransition("REPLANNING", "REPLANNING")).not.toThrow();
  });
});

describe("tasks-machine: قاعدة GEN-2 — الاختصارات مستحيلة بنيويًا", () => {
  it("PLANNING→COMPLETED مستحيل", () => {
    expect(illegal("PLANNING", "COMPLETED")).toBe("task.transition.illegal");
  });

  it("اختصارات أخرى مستحيلة: CREATED→READY · PLANNING→VERIFYING · READY→COMPLETED", () => {
    expect(illegal("CREATED", "READY")).toBe("task.transition.illegal");
    expect(illegal("PLANNING", "VERIFYING")).toBe("task.transition.illegal");
    expect(illegal("READY", "COMPLETED")).toBe("task.transition.illegal");
    expect(illegal("EXECUTING", "COMPLETED")).toBe("task.transition.illegal");
  });
});

describe("tasks-machine: R1 — الانتظار من PLANNING/READY فقط (قبل EXECUTING)", () => {
  it("PLANNING→WAITING_APPROVAL وREADY→WAITING_APPROVAL شرعيان", () => {
    expect(() => assertTransition("PLANNING", "WAITING_APPROVAL")).not.toThrow();
    expect(() => assertTransition("READY", "WAITING_APPROVAL")).not.toThrow();
  });

  it("أبدًا من VERIFYING/COMPLETED — ولا من EXECUTING/OBSERVING/CREATED", () => {
    for (const from of [
      "VERIFYING",
      "COMPLETED",
      "EXECUTING",
      "OBSERVING",
      "CREATED",
      "UNDERSTANDING",
      "PARTIAL",
      "BLOCKED",
    ] as TaskStatus[]) {
      expect(illegal(from, "WAITING_APPROVAL"), `from=${from}`).toBe("task.transition.illegal");
    }
  });

  it("مخارج الانتظار: READY|BLOCKED|REPLANNING فقط", () => {
    for (const to of ["READY", "BLOCKED", "REPLANNING"] as TaskStatus[]) {
      expect(() => assertTransition("WAITING_APPROVAL", to)).not.toThrow();
    }
    for (const to of ["EXECUTING", "VERIFYING", "COMPLETED", "PARTIAL"] as TaskStatus[]) {
      expect(illegal("WAITING_APPROVAL", to), `to=${to}`).toBe("task.transition.illegal");
    }
  });
});

describe("tasks-machine: R3/R4/R5 — النهايات", () => {
  it("PARTIAL من VERIFYING فقط", () => {
    expect(() => assertTransition("VERIFYING", "PARTIAL")).not.toThrow();
    for (const from of ["READY", "OBSERVING", "REPLANNING", "WAITING_APPROVAL", "PLANNING"] as TaskStatus[]) {
      expect(illegal(from, "PARTIAL"), `from=${from}`).toBe("task.transition.illegal");
    }
  });

  it("BLOCKED نهائي — بلا خروج (R4: لا auto-retry)", () => {
    expect(TRANSITIONS.BLOCKED).toEqual([]);
    for (const to of ["READY", "REPLANNING", "EXECUTING", "CREATED"] as TaskStatus[]) {
      expect(illegal("BLOCKED", to), `to=${to}`).toBe("task.transition.illegal");
    }
  });

  it("COMPLETED وPARTIAL نهائيتان (R5)", () => {
    expect(TRANSITIONS.COMPLETED).toEqual([]);
    expect(TRANSITIONS.PARTIAL).toEqual([]);
    expect(illegal("COMPLETED", "READY")).toBe("task.transition.illegal");
    expect(illegal("PARTIAL", "REPLANNING")).toBe("task.transition.illegal");
  });

  it("isTerminal يميّز النهائيات الثلاث فقط", () => {
    for (const s of ["COMPLETED", "PARTIAL", "BLOCKED"] as TaskStatus[]) {
      expect(isTerminal(s)).toBe(true);
    }
    for (const s of ["CREATED", "READY", "WAITING_APPROVAL", "REPLANNING"] as TaskStatus[]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe("tasks-machine: دفاعية", () => {
  it("حالة مجهولة ⇒ رفض مميَّز", () => {
    expect(illegal("NOPE" as TaskStatus, "READY")).toBe("task.state.unknown");
  });
});
