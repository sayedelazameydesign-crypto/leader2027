import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import { setRepos, getRepos } from "@/lib/repositories/container";
import { createSessionToken } from "@/lib/auth/session";
import { GET as campaignGet, PATCH as campaignPatch } from "@/app/api/campaign/route";
import { GET as cyclesGet, POST as cyclesPost } from "@/app/api/cycles/route";
import { PATCH as cyclePatch } from "@/app/api/cycles/[id]/route";
import { POST as regionPost } from "@/app/api/regions/route";
import { POST as teamPost } from "@/app/api/teams/route";

const cookieFor = (uid: string) => ({ cookie: `l27_session=${createSessionToken(uid)}` });

function jsonReq(url: string, method: string, body: unknown, headers: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setRepos(createMemoryRepos(seededStore())));
afterEach(() => setRepos(null));

describe("api-admin-settings: happy + invalid + authorization + audit", () => {
  it("401 بلا جلسة و403 لـCoordinator (AC7)", async () => {
    expect((await campaignGet(new Request("http://t/api/campaign"))).status).toBe(401);
    expect((await campaignGet(new Request("http://t/api/campaign", { headers: cookieFor("user-coordinator") }))).status).toBe(403);
    expect((await cyclesGet(new Request("http://t/api/cycles", { headers: cookieFor("user-worker") }))).status).toBe(403);
    expect((await regionPost(jsonReq("http://t/api/regions", "POST", { name: "منطقة" }, cookieFor("user-viewer")))).status).toBe(403);
  });

  it("GET الحملة + PATCH يُخزَّن + audit (AC1/AC2)", async () => {
    const get = await campaignGet(new Request("http://t/api/campaign", { headers: cookieFor("user-manager") }));
    expect(get.status).toBe(200);
    const before = await get.json();
    expect(before.campaign.name).toBe("حملة Leader 2027");

    const patch = await campaignPatch(jsonReq("http://t/api/campaign", "PATCH", { name: "حملة محدَّثة" }, cookieFor("user-manager")));
    expect(patch.status).toBe(200);
    const after = await patch.json();
    expect(after.campaign.name).toBe("حملة محدَّثة");
    expect(getRepos().campaign.get()?.name).toBe("حملة محدَّثة");

    const events = getRepos().audit.list().filter((e) => e.action === "campaign.update");
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe("user-manager");
  });

  it("إنشاء دورة + تحديث حالتها + audit (AC3)", async () => {
    const created = await cyclesPost(jsonReq("http://t/api/cycles", "POST", {
      name: "دورة فرعية",
      election_date: "2027-06-01",
    }, cookieFor("user-manager")));
    expect(created.status).toBe(201);
    const { cycle } = await created.json();
    expect(cycle.status).toBe("planned");

    const patched = await cyclePatch(jsonReq(`http://t/api/cycles/${cycle.id}`, "PATCH", { status: "active" }, cookieFor("user-manager")), {
      params: Promise.resolve({ id: cycle.id }),
    });
    expect(patched.status).toBe(200);
    expect(getRepos().cycles.getById(cycle.id)?.status).toBe("active");

    const list = await cyclesGet(new Request("http://t/api/cycles", { headers: cookieFor("user-manager") }));
    const data = await list.json();
    expect(data.cycles).toHaveLength(2);

    const actions = getRepos().audit.list().map((e) => e.action);
    expect(actions.filter((a) => a === "cycle.create")).toHaveLength(1);
    expect(actions.filter((a) => a === "cycle.update")).toHaveLength(1);
  });

  it("payloads غير صالحة → 400 (AC8)", async () => {
    const badCycle = await cyclesPost(jsonReq("http://t/api/cycles", "POST", {
      name: "أ", election_date: "01/06/2027", status: "maybe",
    }, cookieFor("user-manager")));
    expect(badCycle.status).toBe(400);

    const badCampaign = await campaignPatch(jsonReq("http://t/api/campaign", "PATCH", { name: "" }, cookieFor("user-manager")));
    expect(badCampaign.status).toBe(400);

    const political = await cyclesPost(jsonReq("http://t/api/cycles", "POST", {
      name: "دورة", election_date: "2027-06-01", political_score: 5,
    }, cookieFor("user-manager")));
    expect(political.status).toBe(400);
  });

  it("منطقة + فريق يُخزَّنان ومرجعية الفريق تُتحقق (AC4)", async () => {
    const region = await regionPost(jsonReq("http://t/api/regions", "POST", { name: "الدقي" }, cookieFor("user-manager")));
    expect(region.status).toBe(201);
    const { region: r } = await region.json();

    const team = await teamPost(jsonReq("http://t/api/teams", "POST", { name: "فريق الدقي", region_id: r.id }, cookieFor("user-manager")));
    expect(team.status).toBe(201);
    expect(getRepos().teams.list()).toHaveLength(3);

    const badTeam = await teamPost(jsonReq("http://t/api/teams", "POST", { name: "فريق مكسور", region_id: "nope" }, cookieFor("user-manager")));
    expect(badTeam.status).toBe(400);

    const actions = getRepos().audit.list().map((e) => e.action);
    expect(actions.filter((a) => a === "region.create")).toHaveLength(1);
    expect(actions.filter((a) => a === "team.create")).toHaveLength(1);
  });
});
