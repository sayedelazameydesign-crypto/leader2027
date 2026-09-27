/**
 * Celia · core/task · **نقاط التفتيش** (GEN-2): كل انتقال حالة يُثبَّت في سجل إلحاقي بسلسلة تجزئة،
 * مع رأس رسم الدليل لحظتها. الإعادة (replay) تتحقق من: تسلسل seq، السلسلة، شرعية كل انتقال،
 * وأن رأس الدليل في كل نقطة موجود فعلًا في رسم الدليل.
 */
import { canonicalJson, sha256Hex } from "../../nexa/index.ts";
import { canTransition, type TaskState } from "./task-state.ts";

export type Checkpoint = {
  seq: number;
  taskId: string;
  at: string;
  from: TaskState | null;
  state: TaskState;
  planVersion: number;
  stepId: string | null;
  note: string;
  evidenceHead: string;
  prevHash: string;
  hash: string;
};

export const CHECKPOINT_GENESIS = "0".repeat(64);

export const checkpointHash = (c: Omit<Checkpoint, "hash">): string => sha256Hex(canonicalJson(c));

export interface CheckpointStore {
  append(c: Checkpoint): void;
  list(): readonly Checkpoint[];
  last(): Checkpoint | null;
}

/** مخزن في الذاكرة مع مصبّ اختياري (سطر JSON لكل نقطة) — الـCLI يمرّر كاتب ملف؛ النواة لا تلمس نظام الملفات. */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly items: Checkpoint[] = [];
  private readonly sink: ((line: string) => void) | undefined;
  constructor(sink?: (line: string) => void) {
    this.sink = sink;
  }
  append(c: Checkpoint): void {
    this.items.push(c);
    this.sink?.(JSON.stringify(c));
  }
  list(): readonly Checkpoint[] {
    return this.items;
  }
  last(): Checkpoint | null {
    return this.items.length ? this.items[this.items.length - 1]! : null;
  }
}

export function makeCheckpoint(prev: Checkpoint | null, fields: Omit<Checkpoint, "seq" | "prevHash" | "hash">): Checkpoint {
  const base = { ...fields, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? CHECKPOINT_GENESIS };
  return { ...base, hash: checkpointHash(base) };
}

export type CheckpointVerification = { ok: boolean; reason: string | null; count: number; final: TaskState | null; states: TaskState[] };

export function verifyCheckpoints(list: readonly Checkpoint[]): CheckpointVerification {
  const states: TaskState[] = [];
  let prev: Checkpoint | null = null;
  for (const c of list) {
    const { hash, ...rest } = c;
    if (checkpointHash(rest) !== hash) return { ok: false, reason: `checkpoint ${c.seq}: hash mismatch`, count: list.length, final: null, states };
    if (c.seq !== (prev?.seq ?? 0) + 1) return { ok: false, reason: `checkpoint ${c.seq}: sequence gap after ${prev?.seq ?? 0}`, count: list.length, final: null, states };
    if (c.prevHash !== (prev?.hash ?? CHECKPOINT_GENESIS)) return { ok: false, reason: `checkpoint ${c.seq}: broken chain`, count: list.length, final: null, states };
    if (prev && c.taskId !== prev.taskId) return { ok: false, reason: `checkpoint ${c.seq}: task id changed`, count: list.length, final: null, states };
    if (!prev) {
      if (c.from !== null || c.state !== "CREATED") return { ok: false, reason: "checkpoint 1 must be CREATED with no predecessor", count: list.length, final: null, states };
    } else {
      if (c.from !== prev.state) return { ok: false, reason: `checkpoint ${c.seq}: from=${c.from} but previous state was ${prev.state}`, count: list.length, final: null, states };
      if (!canTransition(prev.state, c.state)) return { ok: false, reason: `checkpoint ${c.seq}: illegal transition ${prev.state} → ${c.state}`, count: list.length, final: null, states };
    }
    states.push(c.state);
    prev = c;
  }
  return { ok: true, reason: null, count: list.length, final: prev?.state ?? null, states };
}
