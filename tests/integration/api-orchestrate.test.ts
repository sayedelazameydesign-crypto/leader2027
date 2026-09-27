/**
 * V5.3 — اختبارات مسارات /api/orchestrate/** (حدود + مصافحة + حصرية عبر HTTP).
 *
 * المسارات تُستدعى مباشرة (in-process) بمخزن مزروع — الـHTTP للمصافحة،
 * والمنطق العميق مغطى في GEN-4 + بوابة V53.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { TaskEngine } from "@/lib/tasks/engine";
import { PAID_OPERATION } from "@/lib/tasks/types";
import { POST as claimRoute } from "@/app/api/orchestrate/claims/route";
import { POST as heartbeatRoute } from "@/app/api/orchestrate/heartbeats/route";
import { POST as releaseRoute } from "@/app/api/orchestrate/releases/route";
import { POST as stepRoute } from "@/app/api/orchestrate/steps/route";
import { POST as batchRoute } from "@/app/api/orchestrate/batches/route";
import { GET as statusRoute } from "@/app/api/orchestrate/tasks/[id]/status/route";
import { formatV53Gate, runV53SelfChecks } from "@/lib/orchestrate/gate";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });
const statusParams = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(method: string, url: string, body: unknown, headers: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

/** قيادة المهمة داخليًا حتى READY (خطة مجانية أو مختلطة). */
function driveToReady(paid: boolean): string {
  const engine = new TaskEngine(getRepos());
  const actor = { id: "test", kind: "system" } as const;
  const task = engine.createTask("مهمة منسّق", actor);
  engine.understand(task.id, {}, actor);
  engine.plan(
    task.id,
    paid
      ? [
          { id: "free", operation: "collect", costCap: 0 },
          { id: "pay", operation: PAID_OPERATION, costCap: 50 },
          { id: "tail", operation: "summarize", costCap: 0 },
        ]
      : [
          { id: "s1", operation: "collect", costCap: 0 },
          { id: "s2", operation: "summarize", costCap: 0 },
        ],
    actor,
  );
  engine.markReady(task.id, actor);
  return task.id;
}

const COORD = cookieFor("user-coordinator");
const MANAGER = cookieFor("user-manager");
const VIEWER = cookieFor("user-viewer");

describe("api-orchestrate: الحدود والمصفوفة", () => {
  it("401 بلا جلسة على المسارات الستة", async () => {
    const noAuth = {};
    expect((await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: "x" }, noAuth))).status).toBe(401);
    expect((await heartbeatRoute(jsonReq("POST", "http://test/api/orchestrate/heartbeats", { leaseId: "x" }, noAuth))).status).toBe(401);
    expect((await releaseRoute(jsonReq("POST", "http://test/api/orchestrate/releases", { taskId: "x" }, noAuth))).status).toBe(401);
    expect((await stepRoute(jsonReq("POST", "http://test/api/orchestrate/steps", {}, noAuth))).status).toBe(401);
    expect((await batchRoute(jsonReq("POST", "http://test/api/orchestrate/batches", {}, noAuth))).status).toBe(401);
    expect((await statusRoute(new Request("http://test/api/orchestrate/tasks/x/status"), statusParams("x"))).status).toBe(401);
  });

  it("Viewer يقرأ الحالة ولا يطالب (tasks:view بلا manage)", async () => {
    const id = driveToReady(false);
    const denied = await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id }, VIEWER));
    expect(denied.status).toBe(403);
    const step = await stepRoute(
      jsonReq("POST", "http://test/api/orchestrate/steps", { taskId: id, stepId: "s1", verdict: "verified" }, VIEWER),
    );
    expect(step.status).toBe(403);
    const status = await statusRoute(
      new Request(`http://test/api/orchestrate/tasks/${id}/status`, { headers: VIEWER }),
      statusParams(id),
    );
    expect(status.status).toBe(200);
    const view = (await status.json()) as { task: { id: string }; lease: null };
    expect(view.task.id).toBe(id);
    expect(view.lease).toBeNull();
  });

  it("400 لمدخلات فاسدة (ناقص/verdict/دفعة/instance)", async () => {
    const id = driveToReady(false);
    expect((await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", {}, COORD))).status).toBe(400);
    expect(
      (await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id, instance: "ABC!" }, COORD))).status,
    ).toBe(400);
    expect(
      (await stepRoute(jsonReq("POST", "http://test/api/orchestrate/steps", { taskId: id, stepId: "s1", verdict: "maybe" }, COORD))).status,
    ).toBe(400);
    expect(
      (await batchRoute(jsonReq("POST", "http://test/api/orchestrate/batches", { taskId: id, items: [] }, COORD))).status,
    ).toBe(400);
    const huge = Array.from({ length: 26 }, (_, i) => ({ stepId: `s${i}`, verdict: "verified" }));
    expect(
      (await batchRoute(jsonReq("POST", "http://test/api/orchestrate/batches", { taskId: id, items: huge }, COORD))).status,
    ).toBe(400);
    expect(
      (await stepRoute(jsonReq("POST", "http://test/api/orchestrate/steps", { taskId: id, stepId: "s1", verdict: "verified", artifact: { type: "x" } }, COORD))).status,
    ).toBe(400);
  });
});

describe("api-orchestrate: الملكية عبر HTTP", () => {
  it("مطالبة ⇒ هوية من الجلسة · منافس ⇒ denied داخل 200 (لا 409)", async () => {
    const id = driveToReady(false);
    const won = await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id }, COORD));
    expect(won.status).toBe(200);
    const wonBody = (await won.json()) as { status: string; lease: { workerId: string }; reclaimed: boolean };
    expect(wonBody.status).toBe("claimed");
    expect(wonBody.lease.workerId).toBe("u:user-coordinator:0");
    expect(wonBody.reclaimed).toBe(false);

    const rival = await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id }, MANAGER));
    expect(rival.status).toBe(200);
    const rivalBody = (await rival.json()) as { status: string; code: string };
    expect(rivalBody.status).toBe("denied");
    expect(rivalBody.code).toBe("lease.held");

    const rel = await releaseRoute(jsonReq("POST", "http://test/api/orchestrate/releases", { taskId: id }, COORD));
    expect(((await rel.json()) as { status: string }).status).toBe("released");
    const retry = await claimRoute(
      jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id, instance: "night" }, MANAGER),
    );
    const retryBody = (await retry.json()) as { status: string; lease: { workerId: string; fencingToken: number } };
    expect(retryBody.status).toBe("claimed");
    expect(retryBody.lease.workerId).toBe("u:user-manager:night");
    expect(retryBody.lease.fencingToken).toBe(2);
  });

  it("نبضة المالك ⇒ ok · نبضة لاحقة أخرى ⇒ denied (fencing بالهوية)", async () => {
    const id = driveToReady(false);
    const won = (await (
      await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id, instance: "a" }, COORD))
    ).json()) as { lease: { id: string } };
    const hb = await heartbeatRoute(
      jsonReq("POST", "http://test/api/orchestrate/heartbeats", { leaseId: won.lease.id, instance: "a" }, COORD),
    );
    expect(((await hb.json()) as { status: string }).status).toBe("ok");
    const foreign = await heartbeatRoute(
      jsonReq("POST", "http://test/api/orchestrate/heartbeats", { leaseId: won.lease.id, instance: "b" }, COORD),
    );
    const foreignBody = (await foreign.json()) as { status: string; code: string };
    expect(foreign.status).toBe(200);
    expect(foreignBody.status).toBe("denied");
    expect(foreignBody.code).toBe("lease.not_owner");
  });

  it("مهمة مجهولة ⇒ denied داخل 200 · والحالة ⇒ 404", async () => {
    const res = await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: "nope" }, COORD));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { code: string }).code).toBe("task.missing");
    const st = await statusRoute(
      new Request("http://test/api/orchestrate/tasks/nope/status", { headers: COORD }),
      statusParams("nope"),
    );
    expect(st.status).toBe(404);
  });
});

describe("api-orchestrate: التنفيذ عبر HTTP", () => {
  it("خطوة بلا lease ⇒ denied (R7) · ومع lease ⇒ ok + سلسلة سليمة", async () => {
    const id = driveToReady(false);
    const bare = await stepRoute(
      jsonReq("POST", "http://test/api/orchestrate/steps", { taskId: id, stepId: "s1", verdict: "verified" }, COORD),
    );
    expect(((await bare.json()) as { code: string }).code).toBe("lease.not_held");

    await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id }, COORD));
    const done = await stepRoute(
      jsonReq(
        "POST",
        "http://test/api/orchestrate/steps",
        { taskId: id, stepId: "s1", verdict: "verified", observation: { ok: true }, evidence: { n: 1 } },
        COORD,
      ),
    );
    expect(done.status).toBe(200);
    expect(((await done.json()) as { status: string }).status).toBe("ok");
    expect(new TaskEngine(getRepos()).verifyChain(id)).toBe(true);
    const st = await statusRoute(
      new Request(`http://test/api/orchestrate/tasks/${id}/status`, { headers: COORD }),
      statusParams(id),
    );
    const view = (await st.json()) as { progress: { total: number; verified: number } };
    expect(view.progress).toEqual({ total: 2, verified: 1 });
  });

  it("خطوة مدفوعة ⇒ paid_not_wired بلا أي أثر", async () => {
    const id = driveToReady(true);
    await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id }, COORD));
    const res = await stepRoute(
      jsonReq("POST", "http://test/api/orchestrate/steps", { taskId: id, stepId: "pay", verdict: "verified" }, COORD),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; code: string };
    expect(body.status).toBe("denied");
    expect(body.code).toBe("orchestrate.paid_not_wired");
    const repos = getRepos();
    expect(repos.tasks.listAttempts(id)).toHaveLength(0);
    expect(repos.tasks.getTask(id)?.plan.find((s) => s.id === "pay")?.status).toBe("pending");
  });

  it("دفعة [مجاني، مدفوع، مجاني] ⇒ applied=1 وتوقف · والمجانية الكاملة ⇒ completed", async () => {
    const id = driveToReady(true);
    await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: id }, COORD));
    const mixed = await batchRoute(
      jsonReq(
        "POST",
        "http://test/api/orchestrate/batches",
        {
          taskId: id,
          items: [
            { stepId: "free", verdict: "verified" },
            { stepId: "pay", verdict: "verified" },
            { stepId: "tail", verdict: "verified" },
          ],
        },
        COORD,
      ),
    );
    const mixedBody = (await mixed.json()) as {
      completed: boolean;
      applied: number;
      outcomes: Array<{ stepId: string; outcome: { status: string; code?: string } }>;
    };
    expect(mixedBody.completed).toBe(false);
    expect(mixedBody.applied).toBe(1);
    expect(mixedBody.outcomes).toHaveLength(2);
    expect(mixedBody.outcomes[1]?.outcome.code).toBe("orchestrate.paid_not_wired");
    // البادئة دائمة: free verified والباقي pending
    const plan = getRepos().tasks.getTask(id)?.plan;
    expect(plan?.find((s) => s.id === "free")?.status).toBe("verified");
    expect(plan?.find((s) => s.id === "tail")?.status).toBe("pending");

    const clean = driveToReady(false);
    await claimRoute(jsonReq("POST", "http://test/api/orchestrate/claims", { taskId: clean }, COORD));
    const full = await batchRoute(
      jsonReq(
        "POST",
        "http://test/api/orchestrate/batches",
        {
          taskId: clean,
          items: [
            { stepId: "s1", verdict: "verified" },
            { stepId: "s2", verdict: "verified" },
          ],
        },
        COORD,
      ),
    );
    const fullBody = (await full.json()) as { completed: boolean; applied: number };
    expect(fullBody.completed).toBe(true);
    expect(fullBody.applied).toBe(2);
  });
});

describe("api-orchestrate: V53_GATE", () => {
  it("الفحوص الذاتية كلها true (مستخدمان بساعة متحكَّم بها)", () => {
    const result = runV53SelfChecks(() => createMemoryRepos());
    expect(result).toMatchObject({
      runtime: "PASS",
      http_exclusivity_verified: true,
      free_execute_verified: true,
      paid_denied_verified: true,
      batch_stop_verified: true,
      status_verified: true,
    });
  });

  it("الصيغة القانونية ثلاثة أسطر كما في العقد §7", () => {
    const lines = formatV53Gate(runV53SelfChecks(() => createMemoryRepos())).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^V53_GATE  runtime=PASS http_exclusivity_verified=true free_execute_verified=true$/);
    expect(lines[1]).toMatch(/^ {10}paid_denied_verified=true batch_stop_verified=true status_verified=true$/);
    expect(lines[2]).toBe("          tests_pass=ci");
  });
});
