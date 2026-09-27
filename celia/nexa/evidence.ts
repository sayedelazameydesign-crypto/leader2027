/**
 * NEXA — رسم الدليل (Evidence Graph) — مصدر الحقيقة (§14) + إعادة التشغيل (§15).
 *
 * عقد: task / action / evidence / authorization / change / verification.
 * حواف: has_action / produced / authorized_by / changed / caused / verified_by.
 * السجل **إلحاقي** (append-only) بسلسلة تجزئة: كل مدخل يحمل `hash = sha256(prevHash + entry)`،
 * فأي تعديل لاحق يكسر السلسلة (`verifyChain`). التصدير JSONL؛ `fromJSONL` يعيد البناء ويُعيد تشغيل الأحداث بالترتيب.
 *
 * `explain(taskId)` يجيب عن الأسئلة الخمسة: ماذا حدث؟ لماذا؟ ما الدليل؟ من فوّض؟ ماذا تغيّر؟
 */
import { NexaError, canonicalJson, sha256Hex } from "./protocol.ts";

export type NodeType = "task" | "action" | "evidence" | "authorization" | "change" | "verification";
export type EdgeKind = "has_action" | "produced" | "authorized_by" | "changed" | "caused" | "verified_by";

export type GraphNode = { kind: "node"; id: string; type: NodeType; at: string; data: Record<string, unknown> };
export type GraphEdge = { kind: "edge"; from: string; to: string; edge: EdgeKind; at: string };
export type Entry = (GraphNode | GraphEdge) & { seq: number; prev: string; hash: string };

export type Explanation = {
  task: GraphNode | null;
  what: GraphNode[];
  why: string[];
  proof: GraphNode[];
  authorizedBy: GraphNode[];
  changed: GraphNode[];
  verification: GraphNode[];
};

const GENESIS = "0".repeat(64);

export class EvidenceGraph {
  private readonly entries: Entry[] = [];
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];

  private append(item: GraphNode | GraphEdge): Entry {
    const prev = this.entries.length ? this.entries[this.entries.length - 1]!.hash : GENESIS;
    const seq = this.entries.length + 1;
    const hash = sha256Hex(prev + canonicalJson({ seq, ...item }));
    const entry = { ...item, seq, prev, hash } as Entry;
    this.entries.push(entry);
    if (item.kind === "node") this.nodes.set(item.id, item);
    else this.edges.push(item);
    return entry;
  }

  addNode(id: string, type: NodeType, at: string, data: Record<string, unknown> = {}): GraphNode {
    if (this.nodes.has(id)) throw new NexaError("DUPLICATE_NODE", `node "${id}" already exists (append-only: no overwrite)`);
    const node: GraphNode = { kind: "node", id, type, at, data };
    this.append(node);
    return node;
  }

  link(from: string, to: string, edge: EdgeKind, at: string): GraphEdge {
    if (!this.nodes.has(from)) throw new NexaError("UNKNOWN_NODE", `edge from unknown node "${from}"`);
    if (!this.nodes.has(to)) throw new NexaError("UNKNOWN_NODE", `edge to unknown node "${to}"`);
    const e: GraphEdge = { kind: "edge", from, to, edge, at };
    this.append(e);
    return e;
  }

  // ---- سكر تركيبي لأنواع العقد الشائعة ------------------------------------
  task(id: string, at: string, data: Record<string, unknown>): GraphNode {
    return this.addNode(id, "task", at, data);
  }
  action(taskId: string, id: string, at: string, data: Record<string, unknown>): GraphNode {
    const n = this.addNode(id, "action", at, data);
    this.link(taskId, id, "has_action", at);
    return n;
  }
  evidence(actionId: string, id: string, at: string, data: Record<string, unknown>): GraphNode {
    const n = this.addNode(id, "evidence", at, data);
    this.link(actionId, id, "produced", at);
    return n;
  }
  authorization(actionId: string, id: string, at: string, data: Record<string, unknown>): GraphNode {
    const n = this.addNode(id, "authorization", at, data);
    this.link(actionId, id, "authorized_by", at);
    return n;
  }
  change(actionId: string, id: string, at: string, data: Record<string, unknown>): GraphNode {
    const n = this.addNode(id, "change", at, data);
    this.link(actionId, id, "changed", at);
    return n;
  }
  verification(subjectId: string, id: string, at: string, data: Record<string, unknown>): GraphNode {
    const n = this.addNode(id, "verification", at, data);
    this.link(subjectId, id, "verified_by", at);
    return n;
  }

  // ---- استعلام -------------------------------------------------------------
  getNode(id: string): GraphNode | null {
    return this.nodes.get(id) ?? null;
  }
  out(id: string, edge?: EdgeKind): GraphNode[] {
    return this.edges.filter((e) => e.from === id && (!edge || e.edge === edge)).map((e) => this.nodes.get(e.to)!).filter(Boolean);
  }

  explain(taskId: string): Explanation {
    const task = this.getNode(taskId);
    const what = task ? this.out(taskId, "has_action") : [];
    const proof: GraphNode[] = [];
    const authorizedBy: GraphNode[] = [];
    const changed: GraphNode[] = [];
    const why: string[] = [];
    if (task && typeof task.data.goal === "string") why.push(`goal: ${task.data.goal}`);
    for (const a of what) {
      if (typeof a.data.reason === "string") why.push(`${a.id}: ${a.data.reason}`);
      proof.push(...this.out(a.id, "produced"));
      authorizedBy.push(...this.out(a.id, "authorized_by"));
      changed.push(...this.out(a.id, "changed"));
    }
    const verification = task ? [...this.out(taskId, "verified_by"), ...what.flatMap((a) => this.out(a.id, "verified_by"))] : [];
    return { task, what, why, proof, authorizedBy, changed, verification };
  }

  stats(): { nodes: number; edges: number; byType: Record<NodeType, number>; head: string } {
    const byType: Record<NodeType, number> = { task: 0, action: 0, evidence: 0, authorization: 0, change: 0, verification: 0 };
    for (const n of this.nodes.values()) byType[n.type]++;
    return { nodes: this.nodes.size, edges: this.edges.length, byType, head: this.entries.length ? this.entries[this.entries.length - 1]!.hash : GENESIS };
  }

  // ---- التسلسل وإعادة التشغيل ---------------------------------------------
  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n") + (this.entries.length ? "\n" : "");
  }

  static verifyEntries(entries: readonly Entry[]): { ok: boolean; brokenAt: number | null } {
    let prev = GENESIS;
    for (const e of entries) {
      const { hash, prev: p, ...rest } = e;
      if (p !== prev) return { ok: false, brokenAt: e.seq };
      const expected = sha256Hex(prev + canonicalJson(rest));
      if (expected !== hash) return { ok: false, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true, brokenAt: null };
  }

  verifyChain(): { ok: boolean; brokenAt: number | null } {
    return EvidenceGraph.verifyEntries(this.entries);
  }

  /** إعادة البناء من JSONL مع التحقق من السلسلة؛ يُعيد الرسم وقائمة الأحداث بالترتيب (Replay). */
  static fromJSONL(text: string): { graph: EvidenceGraph; replay: string[]; chain: { ok: boolean; brokenAt: number | null } } {
    const entries = text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Entry);
    const chain = EvidenceGraph.verifyEntries(entries);
    if (!chain.ok) throw new NexaError("CHAIN_BROKEN", `evidence chain broken at seq ${chain.brokenAt}`);
    const graph = new EvidenceGraph();
    const replay: string[] = [];
    for (const e of entries) {
      if (e.kind === "node") {
        graph.addNode(e.id, e.type, e.at, e.data);
        replay.push(`${e.seq}. [${e.type}] ${e.id} @ ${e.at}`);
      } else {
        graph.link(e.from, e.to, e.edge, e.at);
        replay.push(`${e.seq}. ${e.from} -${e.edge}-> ${e.to}`);
      }
    }
    const rebuilt = graph.verifyChain();
    if (!rebuilt.ok || graph.stats().head !== entries[entries.length - 1]?.hash && entries.length > 0) {
      throw new NexaError("REPLAY_MISMATCH", "replayed graph head differs from source");
    }
    return { graph, replay, chain };
  }
}
