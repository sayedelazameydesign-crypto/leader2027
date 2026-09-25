import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getRepos, setRepos } from "@/lib/repositories/container";
import { createMemoryRepos } from "@/lib/persistence/memory";
import { seededStore } from "@/lib/persistence/seed";
import type { Repos } from "@/lib/repositories/interfaces";

/**
 * P1 — حاوية DI (`lib/repositories/container.ts`) كسلوك مُختبَر.
 *
 * الثابت المعماري (فرضته بوابة smoke في VS2): عوالم module في `next start` غير
 * مشتركة بين page-bundles وroute-handler-bundles، فلا كاش singleton في وضع file —
 * كل `getRepos()` يعيد مخزناً طازجاً من القرص. أي كاش هنا يُجمِّد الحالة عند أول
 * تحميل (warmup) ويُخفي الكتابات اللاحقة عن الصفحات.
 */

const ENV_KEYS = ["L27_STORE", "L27_DB_PATH"] as const;
const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);

let dir: string;

function restoreEnv(): void {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  setRepos(null);
  dir = mkdtempSync(path.join(tmpdir(), "l27-container-"));
});

afterEach(() => {
  setRepos(null);
  restoreEnv();
  rmSync(dir, { recursive: true, force: true });
});

describe("container — حقن الاختبارات (setRepos)", () => {
  it("المخزن المحقون هو ما يُعاد حرفياً", () => {
    const injected = createMemoryRepos(seededStore());
    setRepos(injected);
    expect(getRepos()).toBe(injected);
  });

  it("setRepos(null) يُلغي الحقن ويعيد للحقيقة البيئية (لا التصاق للـoverride)", () => {
    const injected = createMemoryRepos(seededStore()) as Repos;
    process.env.L27_STORE = "memory";
    setRepos(injected);
    expect(getRepos()).toBe(injected);

    setRepos(null);
    const fromEnv = getRepos();
    expect(fromEnv).not.toBe(injected);
    // ذاكرة مُبذَّرة ⇒ بيانات seed موجودة (وليس مخزناً فارغاً)
    expect(fromEnv.regions.list().length).toBeGreaterThan(0);
  });
});

describe("container — L27_STORE=memory (كاش singleton لكل عالم module)", () => {
  it("نفس المرجع في كل استدعاء", () => {
    process.env.L27_STORE = "memory";
    const first = getRepos();
    const second = getRepos();
    expect(first).toBe(second);
  });

  it("الكتابة تظهر عبر الاستدعاءين (لا نسخ منفصلة)", () => {
    process.env.L27_STORE = "memory";
    const before = getRepos().regions.list().length;
    const created = getRepos().regions.create({ name: "ذاكرة" });
    // create يقبل Omit<Region,"id"> ويولّد المعرّف داخلياً (randomUUID) — سلوك قائم مُثبَّت
    expect(created.id).toBeTruthy();
    expect(getRepos().regions.list()).toHaveLength(before + 1);
  });
});

describe("container — L27_STORE=file (حاوية طازجة من القرص في كل استدعاء)", () => {
  it("كائنان مختلفان في استدعاءين متتاليين (بلا كاش singleton)", () => {
    process.env.L27_STORE = "file";
    process.env.L27_DB_PATH = path.join(dir, "db.json");
    expect(getRepos()).not.toBe(getRepos());
  });

  it("الكتابة عبر حاوية تظهر فوراً في حاوية أخرى (اتساق عبر عوالم module)", () => {
    process.env.L27_STORE = "file";
    process.env.L27_DB_PATH = path.join(dir, "db.json");
    const writer = getRepos();
    const region = writer.regions.create({ name: "منطقة عبر الحاويات" });

    const reader = getRepos();
    expect(reader.regions.getById(region.id)?.name).toBe("منطقة عبر الحاويات");
  });

  it("write-through: الحاوية تُكتب على القرص في كل mutation (لا فقد عند إعادة الإقلاع)", () => {
    process.env.L27_STORE = "file";
    process.env.L27_DB_PATH = path.join(dir, "db.json");
    const team = getRepos().teams.create({ name: "فريق", region_id: "region-giza" });

    const raw = readFileSync(process.env.L27_DB_PATH as string, "utf-8");
    const store = JSON.parse(raw) as { teams: { id: string; name: string }[] };
    expect(store.teams.some((t) => t.id === team.id && t.name === "فريق")).toBe(true);
  });

  it("الافتراضي file — مسار var/data/db.json عندما لا يُعرَّف L27_DB_PATH", () => {
    delete process.env.L27_STORE;
    delete process.env.L27_DB_PATH;
    const repos = getRepos();
    // مخزن مُبذَّر (campaign singleton) ⇒ الحاوية الافتراضية صالحة للقراءة فوراً
    expect(repos.campaign.get()?.id).toBeTruthy();
    expect(repos.users.list().length).toBeGreaterThan(0);
  });
});
