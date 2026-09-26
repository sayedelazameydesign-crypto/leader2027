/**
 * بوابة الموافقات البشرية — Human-in-the-loop للوكلاء (طبقة 2027).
 *
 * القاعدة: **وكيل الذكاء الاصطناعي لا يكتب في النظام بلا موافقة بشرية صريحة.**
 * الأدوات بمستوى `read` تمر مباشرة؛ أدوات `write`/`admin` التي يستدعيها وكيل
 * تُعلَّق حتى يُقرِّرها إنسان، ثم يُستهلك التصريح **مرة واحدة** (single-use).
 *
 * الجلسات البشرية لا تمرّ بهذه البوابة — حكمها عند سياسة الإذن (policy).
 */
import { KernelContractError } from "./types";
import type { ApprovalRequest, ApprovalState } from "./types";

export type { ApprovalRequest, ApprovalState };

/** الصلاحية الافتراضية للطلب: 15 دقيقة (مَقبض قابل للتجاوز من الـcomposition root). */
const DEFAULT_TTL_MS = 15 * 60 * 1000;

export type ApprovalDecision = {
  request: ApprovalRequest;
  decidedBy: string;
  /** دور المُعتمِد — يُنقل ليصبح سلطة التنفيذ عند تفويض وكيل. */
  decidedByRole?: string;
  note?: string;
};

export class ApprovalGate {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private requests = new Map<string, ApprovalRequest>();
  private seq = 0;
  private listeners = new Set<(r: ApprovalRequest) => void>();

  constructor(opts?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts?.now ?? (() => Date.now());
  }

  onChange(listener: (r: ApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(request: ApprovalRequest): void {
    for (const listener of this.listeners) {
      try {
        listener(request);
      } catch {
        /* مراقب معطوب لا يُسقط البوابة */
      }
    }
  }

  /** إنشاء طلب معلَّق — يُرجع معرّفًا يُقرِّره إنسان لاحقًا. */
  request(input: {
    cell: string;
    tool: string;
    actor: string;
    reason: string;
    payload: Record<string, unknown>;
  }): ApprovalRequest {
    this.sweep();
    this.seq += 1;
    const request: ApprovalRequest = {
      id: `apr-${this.seq}-${this.now().toString(36)}`,
      cell: input.cell,
      tool: input.tool,
      actor: input.actor,
      reason: input.reason,
      input: input.payload,
      requestedAt: new Date(this.now()).toISOString(),
      state: "pending",
      decidedBy: null,
      decidedByRole: null,
      decidedAt: null,
      note: null,
    };
    this.requests.set(request.id, request);
    this.changed(request);
    return request;
  }

  get(id: string): ApprovalRequest | null {
    this.sweep();
    return this.requests.get(id) ?? null;
  }

  /**
   * قرار بشري عام. إعادة القرار على طلب محسوم مرفوضة (لا تراجع صامت).
   */
  decide(input: ApprovalDecision & { outcome: "granted" | "denied" }): ApprovalRequest {
    this.sweep();
    const request = this.requests.get(input.request.id);
    if (!request) {
      throw new KernelContractError("approval.missing", `طلب موافقة غير موجود: ${input.request.id}`);
    }
    if (request.state !== "pending") {
      throw new KernelContractError(
        "approval.decided",
        `الطلب ${request.id} محسوم بالفعل (${request.state}) — لا تراجع صامت`,
      );
    }
    request.state = input.outcome;
    request.decidedBy = input.decidedBy;
    request.decidedByRole = input.decidedByRole ?? null;
    request.decidedAt = new Date(this.now()).toISOString();
    request.note = input.note ?? null;
    this.changed(request);
    return request;
  }

  /** منح التصريح. */
  grant(request: ApprovalRequest, decidedBy: string, note?: string, decidedByRole?: string): ApprovalRequest {
    return this.decide({ request, decidedBy, decidedByRole, note, outcome: "granted" });
  }

  /** رفض صريح بسبب مُسجَّل. */
  deny(request: ApprovalRequest, decidedBy: string, reason: string, decidedByRole?: string): ApprovalRequest {
    return this.decide({ request, decidedBy, decidedByRole, note: reason, outcome: "denied" });
  }

  /**
   * استهلاك تصريح مُمنوح — **مرة واحدة فقط** (single-use token).
   * يُرجع الطلب إن كان صالحًا للتنفيذ، وإلا `null`.
   */
  consume(id: string): ApprovalRequest | null {
    this.sweep();
    const request = this.requests.get(id);
    if (!request || request.state !== "granted") return null;
    request.state = "consumed";
    this.changed(request);
    return request;
  }

  /** الطلبات المعلَّقة (لواجهة المراجعة البشرية). */
  pending(): ApprovalRequest[] {
    this.sweep();
    return [...this.requests.values()]
      .filter((r) => r.state === "pending")
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  /** كل الطلبات (الأحدث أولًا) — أثر تدقيقي. */
  all(limit = 50): ApprovalRequest[] {
    this.sweep();
    return [...this.requests.values()]
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit);
  }

  /** إسقاط الطلبات المعلَّقة المنتهية — يمنع تراكم تصاريح ميتة. */
  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const request of this.requests.values()) {
      if (request.state === "pending" && Date.parse(request.requestedAt) < cutoff) {
        request.state = "expired";
      }
    }
  }
}
