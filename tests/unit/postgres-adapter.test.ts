import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { createPostgresRepos } from "@/lib/persistence/postgres";
import { syncQuery } from "@/lib/persistence/sync-pg";
import { setRepos, getRepos } from "@/lib/repositories/container";

afterEach(() => {
  setRepos(null);
  delete process.env.L27_STORE;
  delete process.env.DATABASE_URL;
});

describe("محوّل PostgreSQL — السباكة (VS5/T1)", () => {
  it("بدون DSN ⇒ خطأ صريح (لا سقوط صامت)", () => {
    expect(() => createPostgresRepos("")).toThrow(/DATABASE_URL/);
    expect(() => syncQuery("SELECT 1", [], "")).toThrow(/DATABASE_URL/);
  });

  it("أبن الاستعلام ومخطط SQL موجودان في الشجرة", () => {
    expect(existsSync(path.join(process.cwd(), "lib", "persistence", "pg-child.mjs"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "lib", "persistence", "schema.sql"))).toBe(true);
  });

  it("container: L27_STORE=postgres بلا DATABASE_URL يرفض صراحةً", () => {
    process.env.L27_STORE = "postgres";
    delete process.env.DATABASE_URL;
    expect(() => getRepos()).toThrow(/DATABASE_URL/);
  });
});
