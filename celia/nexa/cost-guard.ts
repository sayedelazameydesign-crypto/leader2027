/**
 * NEXA — حارس التكلفة (Cost Guard).
 *
 * ميزانيات صلبة لكل مهمة ولكل وكيل وللمجموع؛ الحجز قبل التنفيذ، والتسوية بعده بالتكلفة الفعلية
 * (لا يجوز أن تتجاوز المحجوز)، والإفراج عند الإلغاء. الدفتر كامل قابل للتصدير كدليل.
 */
import { NexaError } from "./protocol.ts";

export type CostLimits = { perTaskUsd: number; perAgentUsd: number; totalUsd: number };

export type Reservation = {
  id: string;
  taskId: string;
  agentId: string;
  reservedUsd: number;
  settledUsd: number | null;
  state: "reserved" | "settled" | "released";
  at: string;
};

export type LedgerEntry = { at: string; event: "reserve" | "settle" | "release" | "refuse"; reservationId: string | null; taskId: string; agentId: string; usd: number; note: string };

const round = (n: number): number => Number(n.toFixed(6));

export class CostGuard {
  private readonly limits: CostLimits;
  private readonly reservations = new Map<string, Reservation>();
  private readonly ledger: LedgerEntry[] = [];
  private seq = 0;

  constructor(limits: CostLimits) {
    if (limits.perTaskUsd < 0 || limits.perAgentUsd < 0 || limits.totalUsd < 0) throw new NexaError("BAD_LIMITS", "limits must be >= 0");
    this.limits = limits;
  }

  private committed(filter: (r: Reservation) => boolean): number {
    let sum = 0;
    for (const r of this.reservations.values()) {
      if (!filter(r)) continue;
      if (r.state === "reserved") sum += r.reservedUsd;
      else if (r.state === "settled") sum += r.settledUsd ?? 0;
    }
    return round(sum);
  }

  remaining(taskId: string, agentId: string): { task: number; agent: number; total: number; min: number } {
    const task = round(this.limits.perTaskUsd - this.committed((r) => r.taskId === taskId));
    const agent = round(this.limits.perAgentUsd - this.committed((r) => r.agentId === agentId));
    const total = round(this.limits.totalUsd - this.committed(() => true));
    return { task, agent, total, min: Math.min(task, agent, total) };
  }

  reserve(taskId: string, agentId: string, usd: number, at: string): { ok: true; reservation: Reservation } | { ok: false; reason: string } {
    if (!(usd >= 0) || !Number.isFinite(usd)) return this.refuse(taskId, agentId, usd, at, "amount must be a finite number >= 0");
    const rem = this.remaining(taskId, agentId);
    if (usd > rem.task) return this.refuse(taskId, agentId, usd, at, `exceeds task budget (remaining ${rem.task} USD)`);
    if (usd > rem.agent) return this.refuse(taskId, agentId, usd, at, `exceeds agent budget (remaining ${rem.agent} USD)`);
    if (usd > rem.total) return this.refuse(taskId, agentId, usd, at, `exceeds total budget (remaining ${rem.total} USD)`);
    const reservation: Reservation = { id: `res-${++this.seq}`, taskId, agentId, reservedUsd: round(usd), settledUsd: null, state: "reserved", at };
    this.reservations.set(reservation.id, reservation);
    this.ledger.push({ at, event: "reserve", reservationId: reservation.id, taskId, agentId, usd: reservation.reservedUsd, note: "reserved before execution" });
    return { ok: true, reservation };
  }

  private refuse(taskId: string, agentId: string, usd: number, at: string, reason: string): { ok: false; reason: string } {
    this.ledger.push({ at, event: "refuse", reservationId: null, taskId, agentId, usd, note: reason });
    return { ok: false, reason };
  }

  /** التسوية بالتكلفة الفعلية — لا تتجاوز المحجوز (تجاوزها = خرق حدّ التنفيذ، يُرفع خطأ). */
  settle(reservationId: string, actualUsd: number, at: string): Reservation {
    const r = this.get(reservationId);
    if (r.state !== "reserved") throw new NexaError("NOT_RESERVED", `reservation ${reservationId} is ${r.state}`);
    if (actualUsd > r.reservedUsd + 1e-9) throw new NexaError("OVERSPEND", `actual ${actualUsd} USD exceeds reserved ${r.reservedUsd} USD`);
    r.settledUsd = round(actualUsd);
    r.state = "settled";
    this.ledger.push({ at, event: "settle", reservationId, taskId: r.taskId, agentId: r.agentId, usd: r.settledUsd, note: `released ${round(r.reservedUsd - r.settledUsd)} USD` });
    return r;
  }

  release(reservationId: string, at: string, note = "cancelled"): Reservation {
    const r = this.get(reservationId);
    if (r.state !== "reserved") throw new NexaError("NOT_RESERVED", `reservation ${reservationId} is ${r.state}`);
    r.state = "released";
    this.ledger.push({ at, event: "release", reservationId, taskId: r.taskId, agentId: r.agentId, usd: r.reservedUsd, note });
    return r;
  }

  private get(id: string): Reservation {
    const r = this.reservations.get(id);
    if (!r) throw new NexaError("UNKNOWN_RESERVATION", `reservation ${id} not found`);
    return r;
  }

  entries(): readonly LedgerEntry[] {
    return this.ledger;
  }
}
