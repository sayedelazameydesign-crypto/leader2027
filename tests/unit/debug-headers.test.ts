import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/debug/headers/route";

const saved = process.env.L27_DEBUG_HEADERS;
afterEach(() => {
  if (saved === undefined) delete process.env.L27_DEBUG_HEADERS;
  else process.env.L27_DEBUG_HEADERS = saved;
});

const req = () =>
  new Request("http://test/api/debug/headers", {
    headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" },
  });

describe("route التشخيص — مُطفأ إلا بتصريح صريح", () => {
  it("بلا L27_DEBUG_HEADERS=1 ⇒ 404 (الافتراضي الآمن — لا بصمة بنية)", async () => {
    delete process.env.L27_DEBUG_HEADERS;
    expect((await GET(req())).status).toBe(404);
  });

  it("L27_DEBUG_HEADERS=1 ⇒ يعكس الترويسات الثلاث فقط", async () => {
    process.env.L27_DEBUG_HEADERS = "1";
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      realIp: "203.0.113.7",
      vercelFwd: null,
      xff: "1.2.3.4",
    });
  });
});
