import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { seededStore, demoAccountsAllowed, seedPassword } from "@/lib/persistence/seed";
import { verifyPassword } from "@/lib/auth/password";

const saved: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  for (const k of Object.keys(saved)) delete saved[k];
});

describe("عزل حسابات العرض عن بذر الإنتاج (VS5/T3)", () => {
  beforeEach(() => {
    setEnv("L27_SEED_DEMO_ACCOUNTS", undefined);
    setEnv("L27_BOOTSTRAP_OWNER_EMAIL", undefined);
    setEnv("L27_BOOTSTRAP_OWNER_PASSWORD", undefined);
  });

  it("التطوير/الاختبار: الحسابات مسموحة افتراضيًا — والاختبارات تعمل كما هي", () => {
    setEnv("NODE_ENV", "test");
    setEnv("L27_DEMO_PASSWORD", "fixture-seed-iso-only-2Pw");
    expect(demoAccountsAllowed()).toBe(true);
    expect(seededStore().users).toHaveLength(6);
    expect(verifyPassword(seedPassword(), seededStore().users[0].password_hash)).toBe(true);
  });

  it("الإنتاج بلا صريح: لا حسابات عرض إطلاقًا — ولا أي كلمة مرور ثابتة", () => {
    setEnv("NODE_ENV", "production");
    expect(demoAccountsAllowed()).toBe(false);
    expect(seededStore().users).toHaveLength(0);
  });

  it("الإنتاج مع L27_SEED_DEMO_ACCOUNTS=1: بيئات العرض/الـsmoke تُصرِّح صراحةً", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_SEED_DEMO_ACCOUNTS", "1");
    expect(demoAccountsAllowed()).toBe(true);
    expect(seededStore().users).toHaveLength(6);
  });

  it("مالك bootstrap: يُنشأ من البيئة بكلمة مروره — لا علاقة له بـDemo", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_DEMO_PASSWORD", "fixture-seed-iso-only-2Pw");
    setEnv("L27_BOOTSTRAP_OWNER_EMAIL", "owner@real-campaign.org");
    setEnv("L27_BOOTSTRAP_OWNER_PASSWORD", "a-strong-bootstrap-passphrase");
    const store = seededStore();
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({ email: "owner@real-campaign.org", role: "OWNER" });
    expect(verifyPassword("a-strong-bootstrap-passphrase", store.users[0].password_hash)).toBe(true);
    expect(verifyPassword(seedPassword(), store.users[0].password_hash)).toBe(false);
  });

  it("كلمة مرور bootstrap ضعيفة (<8) ⇒ لا يُنشأ حساب (لا نصف إجراءات)", () => {
    setEnv("NODE_ENV", "production");
    setEnv("L27_BOOTSTRAP_OWNER_EMAIL", "owner@real-campaign.org");
    setEnv("L27_BOOTSTRAP_OWNER_PASSWORD", "short");
    expect(seededStore().users).toHaveLength(0);
  });
});
