/**
 * GEN-4 — اختبارات قواعد الملكية الخالصة (R8/D4 + الـfencing + التوكن).
 */
import { describe, it, expect } from "vitest";
import type { TaskLeaseRecord } from "@/lib/repositories/interfaces";
import {
  attemptToken,
  isHolding,
  isReclaimable,
  latestLeaseOf,
  renewalDeadlineMs,
  resultHash,
} from "@/lib/workers/leases";
import { DEFAULT_HEARTBEAT_MARGIN_MS, DEFAULT_LEASE_TTL_MS } from "@/lib/workers/types";

const T0 = Date.parse("2026-09-27T00:00:00.000Z");

function lease(over: Partial<TaskLeaseRecord> = {}): TaskLeaseRecord {
  return {
    id: "l1",
    taskId: "t1",
    workerId: "worker-a",
    fencingToken: 1,
    acquiredAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + DEFAULT_LEASE_TTL_MS).toISOString(),
    lastHeartbeatAt: new Date(T0).toISOString(),
    releasedAt: null,
    ...over,
  };
}

describe("workers-leases: الأحدث يكسب", () => {
  it("latestLeaseOf يختار أعلى fencingToken", () => {
    const a = lease({ id: "a", fencingToken: 1 });
    const b = lease({ id: "b", fencingToken: 3 });
    const c = lease({ id: "c", fencingToken: 2 });
    expect(latestLeaseOf([a, b, c])?.id).toBe("b");
    expect(latestLeaseOf([])).toBeNull();
  });
});

describe("workers-leases: R8 — موعد التجديد والاسترداد", () => {
  it("الموعد = expiresAt − margin", () => {
    expect(renewalDeadlineMs(lease(), DEFAULT_HEARTBEAT_MARGIN_MS)).toBe(
      T0 + DEFAULT_LEASE_TTL_MS - DEFAULT_HEARTBEAT_MARGIN_MS,
    );
  });

  it("قبل الموعد: غير قابل للاسترداد · بعده: قابل · المُسلَّم: قابل فورًا", () => {
    const l = lease();
    expect(isReclaimable(l, T0 + 1_000, DEFAULT_HEARTBEAT_MARGIN_MS)).toBe(false);
    expect(isReclaimable(l, T0 + DEFAULT_LEASE_TTL_MS - DEFAULT_HEARTBEAT_MARGIN_MS, DEFAULT_HEARTBEAT_MARGIN_MS)).toBe(true);
    expect(isReclaimable(l, T0 + DEFAULT_LEASE_TTL_MS + 1, DEFAULT_HEARTBEAT_MARGIN_MS)).toBe(true);
    expect(isReclaimable({ ...l, releasedAt: new Date(T0).toISOString() }, T0, 0)).toBe(true);
  });
});

describe("workers-leases: الحيازة الشرعية", () => {
  it("الأحدث + المالك + قبل الانتهاء الصلب ⇒ حائز", () => {
    const l = lease();
    expect(isHolding(l, l, "worker-a", T0 + 1_000)).toBe(true);
  });

  it("مستبدَل أو غير مالك أو مُسلَّم أو منتهٍ ⇒ غير حائز", () => {
    const l = lease();
    const newer = lease({ id: "new", fencingToken: 2 });
    expect(isHolding(l, newer, "worker-a", T0)).toBe(false); // مستبدَل
    expect(isHolding(l, l, "worker-b", T0)).toBe(false); // غير مالك
    expect(isHolding({ ...l, releasedAt: new Date(T0).toISOString() }, l, "worker-a", T0)).toBe(false);
    expect(isHolding(l, l, "worker-a", T0 + DEFAULT_LEASE_TTL_MS)).toBe(false); // منتهٍ
    expect(isHolding(l, null, "worker-a", T0)).toBe(false);
  });

  it("داخل نافذة الهامش المالك ما زال حائزًا (حتى يسترده أحد — فيُfence)", () => {
    const l = lease();
    const edge = T0 + DEFAULT_LEASE_TTL_MS - 1;
    expect(isHolding(l, l, "worker-a", edge)).toBe(true);
    expect(isReclaimable(l, edge, DEFAULT_HEARTBEAT_MARGIN_MS)).toBe(true);
  });
});

describe("workers-leases: التوكن والبصمات", () => {
  it("attemptToken حتمي وحساس للحقبة والمقترح", () => {
    const t1 = attemptToken("p", 1);
    expect(t1).toBe(attemptToken("p", 1));
    expect(t1).not.toBe(attemptToken("p", 2)); // حقبة أخرى ⇒ توكن آخر
    expect(t1).not.toBe(attemptToken("q", 1)); // مقترح آخر ⇒ توكن آخر
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resultHash ثابت لنفس النتيجة بلا تأثر بترتيب المفاتيح", () => {
    expect(resultHash({ a: 1, b: 2 })).toBe(resultHash({ b: 2, a: 1 }));
    expect(resultHash({ a: 1 })).not.toBe(resultHash({ a: 2 }));
  });
});
