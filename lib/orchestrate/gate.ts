/**
 * V5.3 — تقرير القبول الذاتي (V53_GATE).
 *
 * «لا ادعاء بلا إثبات»: طبقة الخدمة نفسها تشغّل خمسة فحوص حية
 * (مصنع مقابض يُمرَّر — مستخدمان يحاكيان عاملين بساعة متحكَّم بها).
 * `tests_pass` شاهدها CI نفسه — القيمة الافتراضية `"ci"` تعني ذلك حرفيًا.
 */
import type { Repos } from "@/lib/repositories/interfaces";
import { PAID_OPERATION, type TaskActor } from "@/lib/tasks/types";
import { TaskEngine } from "@/lib/tasks/engine";
import {
  claimTask,
  executeBatchFree,
  executeStepFree,
  getTaskStatus,
  releaseTask,
} from "./service";

export type V53GateResult = {
  runtime: "PASS" | "FAIL";
  http_exclusivity_verified: boolean;
  free_execute_verified: boolean;
  paid_denied_verified: boolean;
  batch_stop_verified: boolean;
  status_verified: boolean;
  detail: Record<string, string>;
};

const SYSTEM: TaskActor = { id: "v53-gate", kind: "system" };
const T0 = Date.parse("2026-09-27T00:00:00.000Z");
const TTL = 30_000;

function check(fn: () => string): { pass: boolean; note: string } {
  try {
    return { pass: true, note: fn() };
  } catch (err) {
    return { pass: false, note: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

function need(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

function driveTask(repos: Repos, goal: string, withPaid: boolean): string {
  const engine = new TaskEngine(repos);
  const task = engine.createTask(goal, SYSTEM);
  engine.understand(task.id, { brief: "gate" }, SYSTEM);
  engine.plan(
    task.id,
    withPaid
      ? [
          { id: "free", operation: "collect", costCap: 0 },
          { id: "pay", operation: PAID_OPERATION, costCap: 50 },
          { id: "tail", operation: "summarize", costCap: 0 },
        ]
      : [
          { id: "s1", operation: "collect", costCap: 0 },
          { id: "s2", operation: "summarize", costCap: 0 },
        ],
    SYSTEM,
  );
  engine.markReady(task.id, SYSTEM);
  return task.id;
}

export function runV53SelfChecks(makeRepos: () => Repos): V53GateResult {
  const detail: Record<string, string> = {};

  const exclusivity = check(() => {
    let t = T0;
    const repos = makeRepos();
    const id = driveTask(repos, "حصرية", false);
    const a = claimTask(repos, "user-a", { taskId: id }, () => t);
    need(a.status === "claimed", "الأول يفوز");
    const b = claimTask(repos, "user-b", { taskId: id }, () => t);
    need(b.status === "denied", "الثاني مرفوض");
    if (b.status === "denied") need(b.code === "lease.held", `code=${b.code}`);
    const rel = releaseTask(repos, "user-a", { taskId: id }, () => t);
    need(rel.status === "released", "التسليم يعمل");
    const retry = claimTask(repos, "user-b", { taskId: id }, () => t);
    need(retry.status === "claimed", "بعد التسليم يفوز الثاني");
    return "exclusive claim → release → handoff";
  });
  detail.exclusivity = exclusivity.note;

  const freeExecute = check(() => {
    let t = T0;
    const repos = makeRepos();
    const id = driveTask(repos, "مجاني", false);
    need(claimTask(repos, "user-a", { taskId: id }, () => t).status === "claimed", "claim");
    const out = executeStepFree(
      repos,
      "user-a",
      { taskId: id, stepId: "s1", verdict: "verified", observation: { ok: true }, evidence: { ok: 1 } },
      () => t,
    );
    need(out.status === "ok", `execute=${out.status}`);
    need(new TaskEngine(repos).verifyChain(id), "السلسلة سليمة بعد التنفيذ");
    const view = getTaskStatus(repos, id, () => t);
    need(view?.progress.verified === 1, "التقدم 1/2");
    return "free step ok + chain valid + progress 1/2";
  });
  detail.freeExecute = freeExecute.note;

  const paidDenied = check(() => {
    let t = T0;
    const repos = makeRepos();
    const id = driveTask(repos, "مدفوع", true);
    need(claimTask(repos, "user-a", { taskId: id }, () => t).status === "claimed", "claim");
    const out = executeStepFree(repos, "user-a", { taskId: id, stepId: "pay", verdict: "verified" }, () => t);
    need(out.status === "denied", `paid=${out.status}`);
    if (out.status === "denied") need(out.code === "orchestrate.paid_not_wired", `code=${out.code}`);
    need(repos.tasks.listAttempts(id).length === 0, "صفر محاولات مسجلة");
    need(repos.tasks.getTask(id)?.plan.find((s) => s.id === "pay")?.status === "pending", "الخطوة pending بلا أثر");
    return "paid denied with zero side effects";
  });
  detail.paidDenied = paidDenied.note;

  const batchStop = check(() => {
    let t = T0;
    const repos = makeRepos();
    const id = driveTask(repos, "دفعة", true);
    need(claimTask(repos, "user-a", { taskId: id }, () => t).status === "claimed", "claim");
    const batch = executeBatchFree(
      repos,
      "user-a",
      {
        taskId: id,
        items: [
          { taskId: id, stepId: "free", verdict: "verified" },
          { taskId: id, stepId: "pay", verdict: "verified" },
          { taskId: id, stepId: "tail", verdict: "verified" },
        ],
      },
      () => t,
    );
    need(batch.completed === false, "توقفت الدفعة");
    need(batch.applied === 1, `applied=${batch.applied}`);
    need(batch.outcomes.length === 2, `outcomes=${batch.outcomes.length}`);
    const stop = batch.outcomes[1]?.outcome;
    need(stop?.status === "denied", "الثاني مرفوض");
    if (stop?.status === "denied") need(stop.code === "orchestrate.paid_not_wired", `code=${stop.code}`);
    return "prefix applied=1 then paid stop";
  });
  detail.batchStop = batchStop.note;

  const status = check(() => {
    let t = T0;
    const repos = makeRepos();
    const id = driveTask(repos, "حالة", false);
    const empty = getTaskStatus(repos, id, () => t);
    need(empty?.lease === null, "قبل المطالبة: بلا lease");
    need(empty?.progress.total === 2 && empty.progress.verified === 0, "التقدم 0/2");
    need(claimTask(repos, "user-a", { taskId: id }, () => t).status === "claimed", "claim");
    const held = getTaskStatus(repos, id, () => t);
    need(held?.lease?.workerId === "u:user-a:0", `holder=${held?.lease?.workerId}`);
    need(held?.lease?.reclaimable === false, "غير قابل للاسترداد بعد");
    t += TTL + 1;
    const dead = getTaskStatus(repos, id, () => t);
    need(dead?.lease?.reclaimable === true, "قابل للاسترداد بعد الانتهاء");
    need(getTaskStatus(repos, "missing", () => t) === null, "المجهولة null");
    return "lease/progress/reclaimable reflected";
  });
  detail.status = status.note;

  const all =
    exclusivity.pass && freeExecute.pass && paidDenied.pass && batchStop.pass && status.pass;
  return {
    runtime: all ? "PASS" : "FAIL",
    http_exclusivity_verified: exclusivity.pass,
    free_execute_verified: freeExecute.pass,
    paid_denied_verified: paidDenied.pass,
    batch_stop_verified: batchStop.pass,
    status_verified: status.pass,
    detail,
  };
}

/** الصيغة القانونية للتقرير — ثلاثة أسطر كما في العقد §7. */
export function formatV53Gate(result: V53GateResult, testsPass = "ci"): string {
  const b = (v: boolean): string => (v ? "true" : "false");
  return (
    `V53_GATE  runtime=${result.runtime} ` +
    `http_exclusivity_verified=${b(result.http_exclusivity_verified)} ` +
    `free_execute_verified=${b(result.free_execute_verified)}\n` +
    `          paid_denied_verified=${b(result.paid_denied_verified)} ` +
    `batch_stop_verified=${b(result.batch_stop_verified)} ` +
    `status_verified=${b(result.status_verified)}\n` +
    `          tests_pass=${testsPass}`
  );
}
