/**
 * ناقل الأحداث — القناة الوحيدة المسموح بها بين الأنوية الذرية.
 *
 * عزل الفشل: مشترِك يرمي استثناءً **لا يُسقط الناشر** — يُسجَّل الحدث
 * `kernel.subscriber.failed` وتواصل بقية الأنوية عملها.
 */
import type { CellId, EventType, KernelEvent } from "./types";

export type Subscriber = {
  owner: CellId | "kernel";
  types: EventType[] | "*";
  handler: (event: KernelEvent) => void | Promise<void>;
};

const RING_SIZE = 200;

export class EventBus {
  private subscribers = new Set<Subscriber>();
  private ring: KernelEvent[] = [];
  private failures = 0;

  subscribe(sub: Subscriber): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  /** عدد المُشتركين — يُستعمل في الفحص والاختبارات. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  get failureCount(): number {
    return this.failures;
  }

  matches(sub: Subscriber, type: EventType): boolean {
    return sub.types === "*" || sub.types.includes(type);
  }

  /**
   * نشر متزامن مع عزل لكل مُشترك.
   * يُرجع عدد المُشتركين الذين فشلوا (لا يُرمى استثناء أبدًا).
   */
  publish(event: KernelEvent): number {
    this.ring.push(event);
    if (this.ring.length > RING_SIZE) this.ring.shift();

    let failed = 0;
    for (const sub of [...this.subscribers]) {
      if (!this.matches(sub, event.type)) continue;
      try {
        const out = sub.handler(event);
        if (out && typeof (out as Promise<void>).catch === "function") {
          // مشترِك غير متزامن: فشله يُعزل أيضًا ولا يسقط الناشر
          (out as Promise<void>).catch(() => {
            this.failures += 1;
            this.recordFailure(sub.owner, event.type);
          });
        }
      } catch {
        failed += 1;
        this.failures += 1;
        this.recordFailure(sub.owner, event.type);
      }
    }
    return failed;
  }

  private recordFailure(owner: CellId | "kernel", type: EventType): void {
    const note: KernelEvent = {
      type: "kernel.subscriber.failed",
      source: "kernel",
      at: new Date().toISOString(),
      payload: { owner, event: type },
    };
    this.ring.push(note);
    if (this.ring.length > RING_SIZE) this.ring.shift();
  }

  /** آخر الأحداث (الأحدث أولًا). */
  recent(limit = 20): KernelEvent[] {
    return this.ring.slice(-limit).reverse();
  }

  clear(): void {
    this.subscribers.clear();
    this.ring = [];
  }
}
