import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { resetRateLimits } from "@/lib/rate-limit";
import { POST as mcpPost } from "@/app/api/mcp/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function initReq(headers: Record<string, string>) {
  return new Request("http://test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

beforeEach(() => {
  setRepos(createMemoryRepos(seededStore()));
  resetRateLimits();
});
afterEach(() => {
  setRepos(null);
  resetRateLimits();
});

describe("مُخدد بوابة الوكلاء", () => {
  it("60 طلبًا/دقيقة لكل وكيل ثم 429 — ومفتاح آخر معزول", async () => {
    const headers = { ...cookieFor("user-viewer"), "x-l27-agent": "rate-probe" };
    for (let i = 0; i < 60; i += 1) {
      const res = await mcpPost(initReq(headers));
      expect(res.status).toBe(200);
    }
    const limited = await mcpPost(initReq(headers));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe(-32029);

    const other = await mcpPost(initReq({ ...cookieFor("user-viewer"), "x-l27-agent": "other-agent" }));
    expect(other.status).toBe(200);
  });
});
