/**
 * GEN-3 — اختبارات مسارات /api/tasks/** (حدود المصادقة + المصفوفة + المصافحة).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { TaskEngine } from "@/lib/tasks/engine";
import { PAID_OPERATION } from "@/lib/tasks/types";
import { GET as listRoute, POST as createRoute } from "@/app/api/tasks/route";
import { GET as getRoute } from "@/app/api/tasks/[id]/route";
import { POST as requestRoute } from "@/app/api/tasks/[id]/approvals/route";
import { POST as decideRoute } from "@/app/api/tasks/approvals/[id]/route";
import { POST as resumeRoute } from "@/app/api/tasks/[id]/resume/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(method: string, url: string, body: unknown, headers: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

/** قيادة المهمة داخليًا حتى READY (التنفيذ in-process — الـHTTP للمصافحة). */
function driveToReady(goal = "مهمة API"): string {
  const engine = new TaskEngine(getRepos());
  const task = engine.createTask(goal, { id: "test", kind: "system" });
  engine.understand(task.id, {}, { id: "test", kind: "system" });
  engine.plan(task.id, [{ id: "pay", operation: PAID_OPERATION, costCap: 50 }], { id: "test", kind: "system" });
  engine.markReady(task.id, { id: "test", kind: "system" });
  return task.id;
}

const PROPOSAL = { operation: PAID_OPERATION, costCap: 50, args: { q: 1 } };

describe("api-tasks: الحدود والمصفوفة", () => {
  it("401 بلا جلسة", async () => {
    expect((await listRoute(new Request("http://test/api/tasks"))).status).toBe(401);
    expect(
      (await createRoute(jsonReq("POST", "http://test/api/tasks", { goal: "x" }, {}))).status,
    ).toBe(401);
  });

  it("Viewer يقرأ ولا يدير (tasks:view بلا tasks:manage)", async () => {
    const list = await listRoute(new Request("http://test/api/tasks", { headers: cookieFor("user-viewer") }));
    expect(list.status).toBe(200);
    const denied = await createRoute(
      jsonReq("POST", "http://test/api/tasks", { goal: "ممنوعة" }, cookieFor("user-viewer")),
    );
    expect(denied.status).toBe(403);
  });

  it("Coordinator ينشئ ⇒ 201 والتفاصيل ⇒ 200 مع chainValid", async () => {
    const created = await createRoute(
      jsonReq("POST", "http://test/api/tasks", { goal: "مهمة ميدانية" }, cookieFor("user-coordinator")),
    );
    expect(created.status).toBe(201);
    const { task } = await created.json();
    expect(task.status).toBe("CREATED");

    const detail = await getRoute(
      new Request(`http://test/api/tasks/${task.id}`, { headers: cookieFor("user-viewer") }),
      params(task.id),
    );
    expect(detail.status).toBe(200);
    const data = await detail.json();
    expect(data.task.goal).toBe("مهمة ميدانية");
    expect(data.chainValid).toBe(true);
    expect(data.checkpoints).toHaveLength(1);
  });

  it("هدف فارغ ⇒ 400 · غير موجود ⇒ 404", async () => {
    const bad = await createRoute(
      jsonReq("POST", "http://test/api/tasks", { goal: "  " }, cookieFor("user-coordinator")),
    );
    expect(bad.status).toBe(400);
    const missing = await getRoute(
      new Request("http://test/api/tasks/nope", { headers: cookieFor("user-viewer") }),
      params("nope"),
    );
    expect(missing.status).toBe(404);
  });
});

describe("api-tasks: مصافحة الموافقة كاملة عبر HTTP", () => {
  it("طلب ⇒ 201 WAITING · اعتماد Manager ⇒ 200 · استئناف ⇒ 200 READY", async () => {
    const id = driveToReady();
    const req = await requestRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/approvals`,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    expect(req.status).toBe(201);
    const { approval, task } = await req.json();
    expect(task.status).toBe("WAITING_APPROVAL");

    const decide = await decideRoute(
      jsonReq("POST", `http://test/api/tasks/approvals/${approval.id}`, { decision: "approved" }, cookieFor("user-manager")),
      params(approval.id),
    );
    expect(decide.status).toBe(200);
    const granted = await decide.json();
    expect(granted.grant).not.toBeNull();

    const resume = await resumeRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/resume`,
        { approvalId: approval.id, operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    expect(resume.status).toBe(200);
    expect((await resume.json()).task.status).toBe("READY");
  });

  it("القرار Manager+ فقط — Coordinator وViewer ⇒ 403", async () => {
    const id = driveToReady();
    const req = await requestRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/approvals`,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    const { approval } = await req.json();
    for (const uid of ["user-coordinator", "user-viewer"]) {
      const res = await decideRoute(
        jsonReq("POST", `http://test/api/tasks/approvals/${approval.id}`, { decision: "approved" }, cookieFor(uid)),
        params(approval.id),
      );
      expect(res.status, uid).toBe(403);
    }
  });

  it("مقترح غير مطابق ⇒ 403 DENY وتبقى WAITING_APPROVAL", async () => {
    const id = driveToReady();
    const req = await requestRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/approvals`,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    const { approval } = await req.json();
    await decideRoute(
      jsonReq("POST", `http://test/api/tasks/approvals/${approval.id}`, { decision: "approved" }, cookieFor("user-manager")),
      params(approval.id),
    );
    const bad = await resumeRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/resume`,
        {
          approvalId: approval.id,
          operation: PAID_OPERATION,
          costCap: 50,
          proposal: { ...PROPOSAL, args: { q: 999 } },
        },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    expect(bad.status).toBe(403);
    const detail = await getRoute(
      new Request(`http://test/api/tasks/${id}`, { headers: cookieFor("user-viewer") }),
      params(id),
    );
    expect((await detail.json()).task.status).toBe("WAITING_APPROVAL");
  });

  it("رفض ⇒ BLOCKED · والاستئناف بعده ⇒ 409 (لا استمرار صامت)", async () => {
    const id = driveToReady();
    const req = await requestRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/approvals`,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    const { approval } = await req.json();
    const deny = await decideRoute(
      jsonReq("POST", `http://test/api/tasks/approvals/${approval.id}`, { decision: "rejected" }, cookieFor("user-manager")),
      params(approval.id),
    );
    expect(deny.status).toBe(200);
    expect((await deny.json()).task.status).toBe("BLOCKED");

    const resume = await resumeRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/resume`,
        { approvalId: approval.id, operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    expect(resume.status).toBe(409);
  });

  it("طلب من CREATED (قبل التخطيط) ⇒ 409 — الحارس البنيوي حيّ", async () => {
    const created = await createRoute(
      jsonReq("POST", "http://test/api/tasks", { goal: "مبكرة" }, cookieFor("user-coordinator")),
    );
    const { task } = await created.json();
    const req = await requestRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${task.id}/approvals`,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal: PROPOSAL },
        cookieFor("user-coordinator"),
      ),
      params(task.id),
    );
    expect(req.status).toBe(409);
  });

  it("مقترح §5 ⇒ 400 · قرار فاسد ⇒ 400", async () => {
    const id = driveToReady();
    const forbidden = await requestRoute(
      jsonReq(
        "POST",
        `http://test/api/tasks/${id}/approvals`,
        { stepId: "pay", operation: PAID_OPERATION, costCap: 50, proposal: { political_score: 5 } },
        cookieFor("user-coordinator"),
      ),
      params(id),
    );
    expect(forbidden.status).toBe(400);

    const badDecision = await decideRoute(
      jsonReq("POST", "http://test/api/tasks/approvals/x", { decision: "maybe" }, cookieFor("user-manager")),
      params("x"),
    );
    expect(badDecision.status).toBe(400);
  });
});
