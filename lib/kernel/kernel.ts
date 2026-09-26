/**
 * النواة الحيّة (Live Kernel) — تركيب الأنوية الذرية وتشغيلها ومراقبتها.
 *
 * دستور النواة:
 *  1. **لا تعرف النواة أي خلية بالاسم** — كل خلية تُسجِّل نفسها (`register`).
 *  2. **فشل خلية لا يُسقط النظام** — تُعزَل كـ`degraded` وتواصل البقية.
 *  3. **الاستبدال الساخن** لا ينكسر: عقد التوافق يُتحقق منه قبل التبديل.
 *  4. **الوصول عبر القدرات لا عبر الوحدات** — لا استيراد مباشر بين الخلايا.
 *  5. **كل نداء أداة مُدقَّق** — والمُفشِل يُعزى إلى نواته وحدها.
 */
import { EventBus, type Subscriber } from "./bus";
import { ApprovalGate } from "./approvals";
import { KernelContractError, RISK_ORDER } from "./types";
import type {
  Actor,
  ApprovalRequest,
  ApprovalStamp,
  Capability,
  CapabilityId,
  Cell,
  CellId,
  CellManifest,
  CellRuntime,
  ConfigSlot,
  EventType,
  KernelEvent,
  KernelSnapshot,
  LifecycleState,
  MountContext,
  ResolvedConfig,
  RiskLevel,
  ToolContext,
  ToolDescriptor,
} from "./types";
import { assertSwappable, resolveConfig, validateCell } from "./manifest";

export type ExecuteOptions = {
  actor: Actor;
  /** **إلزامي** عند استدعاء وكيل لأداة كتابة — تصريح بشري مُمنوح. */
  approvalId?: string;
  reason?: string;
  /** مَخرج إضافي للمراقبة (لا يؤثر في النتيجة). */
  onEvent?: (event: KernelEvent) => void;
};

export type ExecuteOutcome =
  | {
      status: "ok";
      tool: string;
      cell: CellId;
      risk: RiskLevel;
      value: unknown;
      ms: number;
    }
  | {
      status: "pending_approval";
      tool: string;
      cell: CellId;
      risk: RiskLevel;
      approvalId: string;
      reason: string;
    }
  | { status: "denied"; tool: string; reason: string }
  | { status: "error"; tool: string; cell: CellId; code: string; message: string };

/** فاعل نظامي — للأحداث الداخلية للنواة (لا صلاحيات نطاق). */
export const SYSTEM_ACTOR: Actor = { id: "kernel", role: "SYSTEM", kind: "agent" };

type Record_ = {
  cell: Cell;
  manifest: CellManifest;
  config: ResolvedConfig;
  configOverrides: Record<string, unknown>;
  state: LifecycleState;
  tools: Map<string, ToolDescriptor>;
  health: CellRuntime["health"];
  mountedAt: string | null;
  lastError: string | null;
  swaps: number;
};

export type KernelOptions = {
  /** مهلة فحص الصحة بالمللي ثانية. */
  healthTimeoutMs?: number;
  /** صلاحية طلب الموافقة. */
  approvalTtlMs?: number;
  /** حقن زمن — للاختبارات الحتمية. */
  now?: () => number;
};

export class Kernel {
  private records = new Map<CellId, Record_>();
  private capabilities = new Map<CapabilityId, Capability>();
  private subscribers = new Map<CellId, () => void>();
  private routes = new Map<string, CellId>();
  private listeners = new Set<(event: KernelEvent) => void>();
  private started = false;
  private failures = 0;

  readonly bus = new EventBus();
  readonly approvals: ApprovalGate;
  private readonly options: Required<KernelOptions>;

  constructor(options: KernelOptions = {}) {
    this.options = {
      healthTimeoutMs: options.healthTimeoutMs ?? 500,
      approvalTtlMs: options.approvalTtlMs ?? 15 * 60 * 1000,
      now: options.now ?? (() => Date.now()),
    };
    this.approvals = new ApprovalGate({
      ttlMs: this.options.approvalTtlMs,
      now: this.options.now,
    });

    /**
     * قدرات مدمجة تُشبعها النواة نفسها — تسمح للأنوية بالوصول إلى السجل وبوابة
     * الموافقات **دون استيراد النواة** (لا دورات استيراد، ولا خرق للعزل).
     */
    this.provide("kernel.registry", { ar: "سجل النواة", en: "Kernel registry" }, "read", {
      cells: () => this.list(),
      tools: () => this.tools(),
      snapshot: () => this.snapshot(),
      catalogue: () => this.catalogue(),
    });
    this.provide("kernel.approvals", { ar: "بوابة الموافقات", en: "Approval gate" }, "admin", {
      pending: () => this.approvals.pending(),
      all: (limit?: number) => this.approvals.all(limit ?? 50),
      grant: (id: string, by: string, note?: string, role?: string) => {
        const request = this.approvals.get(id);
        if (!request) throw new KernelContractError("approval.missing", `طلب موافقة غير موجود: ${id}`);
        return this.approvals.grant(request, by, note, role);
      },
      deny: (id: string, by: string, reason: string, role?: string) => {
        const request = this.approvals.get(id);
        if (!request) throw new KernelContractError("approval.missing", `طلب موافقة غير موجود: ${id}`);
        return this.approvals.deny(request, by, reason, role);
      },
    });
  }

  /** تسجيل قدرة مُشبَعة — الطريقة الوحيدة لإشباع القدرات. */
  private provide(
    capability: CapabilityId,
    label: Capability["label"],
    risk: RiskLevel,
    value: unknown,
  ): void {
    this.capabilities.set(capability, {
      id: capability,
      label,
      risk,
      providedBy: "kernel",
      value,
    });
  }

  /* ------------------------------------------------------------ تسجيل */

  /**
   * تسجيل نواة ذرية — يتحقق من العقد أولًا، ثم يثبّتها **إن أُشبعت متطلباتها**.
   * خلية بمتطلبات غير مُشبَعة تُسجَّل `blocked` ولا تُسقط التسجيل.
   */
  register(cell: Cell): LifecycleState {
    validateCell(cell);
    const manifest = cell.manifest;
    const id = manifest.id;

    if (this.records.has(id) && this.records.get(id)!.state !== "retired") {
      throw new KernelContractError(
        "register.duplicate",
        `معرّف خلية مُستخدم: "${id}" — للاستبدال استعمل kernel.replace(cell)`,
      );
    }

    // تعارض الإشباع: قدرة تُشبعها نواتان نشطتان ⇒ رفض صريح (لا غلبة صامتة)
    for (const capability of manifest.provides) {
      const owner = this.capabilities.get(capability);
      const ownerRecord = owner ? this.records.get(owner.providedBy) : undefined;
      const ownedByKernel = owner?.providedBy === "kernel";
      if (owner && owner.providedBy !== id && (ownedByKernel || (ownerRecord && !this.isRetired(owner.providedBy)))) {
        throw new KernelContractError(
          "register.capability.conflict",
          `القدرة "${capability}" مُشبَعة من "${owner.providedBy}" — لا يمكن إشباعها من "${id}" معًا`,
        );
      }
    }

    const record: Record_ = {
      cell,
      manifest,
      config: resolveConfig(manifest),
      configOverrides: {},
      state: "declared",
      tools: new Map(manifest.tools.map((t) => [t.name, t])),
      health: null,
      mountedAt: null,
      lastError: null,
      swaps: 0,
    };
    this.records.set(id, record);

    const missing = manifest.requires.filter((c) => !this.capabilities.has(c));
    if (missing.length) {
      // قدرة تُشترط على نفسها (self-provided) لا تُحتسب — لا توهم إشباع
      record.state = "blocked";
      record.lastError = `متطلبات غير مُشبَعة: [${missing.join(", ")}]`;
      return record.state;
    }

    this.mount(id);
    return this.records.get(id)!.state;
  }

  private isRetired(id: string): boolean {
    const record = this.records.get(id);
    return !!record && record.state === "retired";
  }

  /** تركيب فعلي: أنشئ السياق، ثم onMount، ثم أشبع القدرات، ثم اشترك في الناقل. */
  private mount(id: CellId): void {
    const record = this.records.get(id)!;
    const { manifest, cell } = record;

    const ctx: MountContext = {
      // getter لا قيمة: تعديل المَقابض لاحقًا يجب أن يصل للنواة فورًا،
      // وإلا بقيت الخلية تعمل بإعدادات التركيب الأولى إلى الأبد.
      get config() {
        return record.config;
      },
      require: (capability) => this.require(capability),
      emit: (type, payload) => this.publish(type, id, payload),
    };

    try {
      const result = cell.onMount?.(ctx);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err: unknown) => {
          record.lastError = err instanceof Error ? err.message : String(err);
        });
      }
    } catch (err) {
      record.state = "degraded";
      record.lastError = err instanceof Error ? err.message : String(err);
      this.failures += 1;
      this.publish("kernel.cell.failed", "kernel", { cell: id, phase: "onMount", reason: record.lastError });
      return;
    }

    for (const capability of manifest.provides) {
      const tool = manifest.tools.find((t) => t.capability === capability);
      this.capabilities.set(capability, {
        id: capability,
        label: tool?.label ?? manifest.title,
        risk: tool?.risk ?? "read",
        providedBy: id,
        value: (cell.services ?? {})[capability],
      });
    }
    for (const tool of manifest.tools) this.routes.set(tool.name, id);

    // اشتراك في الأحداث المُعلَنة فقط
    if (manifest.consumes.length) {
      this.unsubscribe(id);
      const unsubscribe = this.bus.subscribe({
        owner: id,
        types: [...manifest.consumes],
        handler: (event) => {
          const handler = record.cell.onEvent;
          if (typeof handler === "function") {
            return handler(event, {
              config: record.config,
              require: (capability) => this.require(capability),
              emit: (type, payload) => this.publish(type, id, payload),
            });
          }
        },
      });
      this.subscribers.set(id, unsubscribe);
    }

    record.state = "mounted";
    record.lastError = null;
    record.mountedAt = new Date(this.options.now()).toISOString();
  }

  private unsubscribe(id: CellId): void {
    const off = this.subscribers.get(id);
    if (off) {
      off();
      this.subscribers.delete(id);
    }
  }

  /** يبدأ النواة: يفحص الصحة، ويُنشِّط ما نجح، ويُعزل ما فشل. */
  async start(): Promise<KernelSnapshot> {
    this.started = true;
    // إعادة محاولة الخلايا المحجوبة (ربما أُشبعت متطلباتها لاحقًا)
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, record] of this.records) {
        if (record.state !== "blocked") continue;
        const missing = record.manifest.requires.filter((c) => !this.capabilities.has(c));
        if (!missing.length) {
          this.mount(id);
          progressed = true;
        }
      }
    }

    for (const id of this.records.keys()) {
      const record = this.records.get(id)!;
      if (record.state === "retired" || record.state === "blocked" || record.state === "degraded") continue;
      await this.activate(id);
    }

    this.publish("kernel.started", "kernel", {
      cells: this.snapshot().stats,
    });
    return this.snapshot();
  }

  /** تنشيط مع فحص صحة معزول: فشل الفحص = degraded، لا انهيار. */
  private async activate(id: CellId): Promise<void> {
    const record = this.records.get(id)!;
    if (!record.cell.health) {
      record.state = "active";
      this.publish("kernel.cell.mounted", "kernel", { cell: id, version: record.manifest.version });
      return;
    }
    try {
      const report = await this.withTimeout(Promise.resolve(record.cell.health()), this.options.healthTimeoutMs);
      record.health = report;
      if (report.ok) {
        record.state = "active";
        this.publish("kernel.cell.mounted", "kernel", { cell: id, version: record.manifest.version });
      } else {
        record.state = "degraded";
        record.lastError = report.detail;
        this.failures += 1;
        this.publish("kernel.cell.failed", "kernel", { cell: id, phase: "health", reason: report.detail });
      }
    } catch (err) {
      record.state = "degraded";
      record.lastError = err instanceof Error ? err.message : String(err);
      this.failures += 1;
      this.publish("kernel.cell.failed", "kernel", { cell: id, phase: "health", reason: record.lastError });
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`انتهت المهلة (${ms}ms)`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /* --------------------------------------------------- الاستبدال الساخن */

  /**
   * استبدال خلية بنسخة أحدث **دون إعادة تشغيل النظام ودون فقدان السجل**:
   *  1. تحقق العقد والتوافق.
   *  2. تحقق صحة النسخة الجديدة **قبل** المساس بالقديمة (فشل = لا تغيير).
   *  3. onUnmount للقديمة → العلم عليها `retired` → تسجيل الجديدة.
   * الإعدادات السابقة تنتقل إن أُعلنت في النسخة الجديدة.
   */
  async replace(cell: Cell): Promise<{ id: CellId; from: string; to: string; state: LifecycleState }> {
    validateCell(cell);
    const id = cell.manifest.id;
    const current = this.records.get(id);
    if (!current) {
      throw new KernelContractError("replace.missing", `لا توجد خلية مُركَّبة بالمعرّف "${id}"`);
    }
    assertSwappable(current.manifest, cell.manifest);

    // 1) فحص صحة النسخة الجديدة قبل التبديل — لا نُسقط خلية عاملة بنسخة معطوبة
    if (cell.health) {
      try {
        const report = await this.withTimeout(Promise.resolve(cell.health()), this.options.healthTimeoutMs);
        if (!report.ok) {
          throw new KernelContractError(
            "replace.health",
            `"${id}"@${cell.manifest.version}: فحص الصحة فشل (${report.detail}) — أُبقي على النسخة الحالية`,
          );
        }
      } catch (err) {
        if (err instanceof KernelContractError) throw err;
        throw new KernelContractError(
          "replace.health",
          `"${id}"@${cell.manifest.version}: تعذّر فحص الصحة (${err instanceof Error ? err.message : String(err)}) — أُبقي على النسخة الحالية`,
        );
      }
    }

    // 2) تحقق أن القدرات المُشبَعة لم يُسحب أيٌّ منها (مكرَّر مع assertSwappable للتأكيد الصريح)
    const nextProvides = new Set(cell.manifest.provides);
    const dropped = current.manifest.provides.filter((c) => !nextProvides.has(c));
    if (dropped.length) {
      throw new KernelContractError("replace.capability", `النسخة الجديدة تُسقط قدرات: [${dropped.join(", ")}]`);
    }

    const carried: Record<string, unknown> = {};
    const nextSlots = new Set((cell.manifest.config ?? []).map((s: ConfigSlot) => s.key));
    for (const [key, value] of Object.entries(current.configOverrides)) {
      if (nextSlots.has(key)) carried[key] = value;
    }

    // 3) تقاعد القديمة
    const from = current.manifest.version;
    try {
      const result = current.cell.onUnmount?.();
      if (result && typeof (result as Promise<void>).catch === "function") {
        await (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* فشل التنظيف لا يمنع الاستبدال */
    }
    this.unsubscribe(id);
    for (const capability of current.manifest.provides) {
      if (this.capabilities.get(capability)?.providedBy === id) this.capabilities.delete(capability);
    }
    for (const name of current.tools.keys()) this.routes.delete(name);

    current.state = "retired";
    this.records.delete(id);

    const state = this.register({ ...cell, manifest: cell.manifest });
    const next = this.records.get(id)!;
    next.swaps = current.swaps + 1;
    next.configOverrides = carried;
    if (Object.keys(carried).length) next.config = resolveConfig(cell.manifest, carried);
    if (this.started && state !== "blocked") await this.activate(id);

    this.publish("kernel.cell.swapped", "kernel", {
      cell: id,
      from,
      to: cell.manifest.version,
      state: this.records.get(id)!.state,
      carriedConfig: Object.keys(carried),
    });

    return { id, from, to: cell.manifest.version, state: this.records.get(id)!.state };
  }

  /** إلغاء تركيب خلية — بلا حذف سجلها (يبقى أثرًا للتدقيق). */
  unmount(id: CellId): boolean {
    const record = this.records.get(id);
    if (!record || record.state === "retired") return false;
    this.unsubscribe(id);
    for (const capability of record.manifest.provides) {
      if (this.capabilities.get(capability)?.providedBy === id) this.capabilities.delete(capability);
    }
    for (const name of record.tools.keys()) this.routes.delete(name);
    try {
      record.cell.onUnmount?.();
    } catch {
      /* معزول */
    }
    record.state = "retired";
    this.publish("kernel.cell.unmounted", "kernel", { cell: id });
    return true;
  }

  /* ----------------------------------------------------- قدرات وتشغيل */

  /** استرجاع قدرة — الطريقة الوحيدة للتخاطب بين الأنوية. */
  require<T = unknown>(capability: CapabilityId): T {
    const entry = this.capabilities.get(capability);
    if (!entry) {
      throw new KernelContractError(
        "capability.missing",
        `القدرة "${capability}" غير مُشبَعة — لا وصول مباشر بين الأنوية`,
      );
    }
    return entry.value as T;
  }

  has(capability: CapabilityId): boolean {
    return this.capabilities.has(capability);
  }

  list(filters?: { state?: LifecycleState; corner?: string }): CellRuntime[] {
    return [...this.records.values()]
      .filter((r) => (filters?.state ? r.state === filters.state : true))
      .filter((r) => (filters?.corner ? r.manifest.corner === filters.corner : true))
      .map((r) => this.view(r));
  }

  cell(id: CellId): CellRuntime | null {
    const record = this.records.get(id);
    return record ? this.view(record) : null;
  }

  /** المَقابض القابلة للتعديل لخلية — «جزء كل ركن» معروضًا للواجهة والوكلاء. */
  slots(id: CellId): ConfigSlot[] {
    return this.records.get(id)?.manifest.config ?? [];
  }

  /**
   * تعديل إعدادات خلية واحدة.
   * التحقق صارم: مفتاح غير مُعلَن ⇒ رفض؛ نواة أخرى **لا تتأثر إطلاقًا**.
   */
  configure(
    id: CellId,
    patch: Record<string, unknown>,
    actor: Actor,
  ): { id: CellId; config: ResolvedConfig; changed: string[] } {
    const record = this.records.get(id);
    if (!record) throw new KernelContractError("configure.missing", `خلية غير معروفة: "${id}"`);

    const nextOverrides = { ...record.configOverrides, ...patch };
    const nextConfig = resolveConfig(record.manifest, nextOverrides);
    const changed = Object.keys(patch).filter((k) => record.config[k] !== nextConfig[k]);

    record.configOverrides = nextOverrides;
    record.config = nextConfig;
    this.publish("kernel.config.changed", "kernel", { cell: id, changed, by: actor.id, kind: actor.kind });
    return { id, config: nextConfig, changed };
  }

  /** إعادة المَقابض إلى الافتراضي المُعلَن في الـmanifest. */
  resetConfig(id: CellId, actor: Actor): ResolvedConfig {
    const record = this.records.get(id);
    if (!record) throw new KernelContractError("configure.missing", `خلية غير معروفة: "${id}"`);
    record.configOverrides = {};
    record.config = resolveConfig(record.manifest);
    this.publish("kernel.config.reset", "kernel", { cell: id, by: actor.id, kind: actor.kind });
    return record.config;
  }

  tools(filters?: { risk?: RiskLevel; cell?: CellId }): ToolDescriptor[] {
    const out: ToolDescriptor[] = [];
    for (const record of this.records.values()) {
      if (record.state === "retired" || record.state === "blocked") continue;
      if (filters?.cell && record.manifest.id !== filters.cell) continue;
      for (const tool of record.manifest.tools) {
        if (filters?.risk && tool.risk !== filters.risk) continue;
        out.push(tool);
      }
    }
    return out;
  }

  /**
   * تنفيذ أداة — نقطة الدخول الوحيدة للوكلاء والبشر.
   *
   * الترتيب ملزم: وجود الأداة → صحة الخلية → **بوابة الموافقة للوكلاء** → تنفيذ معزول.
   */
  async execute(name: string, input: Record<string, unknown>, options: ExecuteOptions): Promise<ExecuteOutcome> {
    const cellId = this.routes.get(name);
    if (!cellId) {
      return { status: "error", tool: name, cell: "kernel", code: "tool.unknown", message: `أداة غير معروفة: "${name}"` };
    }
    const record = this.records.get(cellId);
    if (!record) {
      return { status: "error", tool: name, cell: cellId, code: "cell.missing", message: `خلية مفقودة: "${cellId}"` };
    }
    const descriptor = record.tools.get(name)!;

    if (record.state === "degraded" || record.state === "retired" || record.state === "blocked") {
      this.failures += 1;
      this.publish("kernel.call.rejected", "kernel", { tool: name, cell: cellId, state: record.state, reason: record.lastError });
      return {
        status: "error",
        tool: name,
        cell: cellId,
        code: "cell.unavailable",
        message: `الخلية "${cellId}" في حالة ${record.state} — فشلها معزول عن بقية النظام`,
      };
    }

    const actor = options.actor;
    const isAgent = actor.kind === "agent";
    let stamp: ApprovalStamp | undefined;
    let effectiveActor: Actor = actor;
    let onBehalfOf: Actor | undefined;

    // بوابة 2027: وكيل + أداة كتابة ⇒ لا كتابة بلا موافقة بشرية
    if (isAgent && (RISK_ORDER[descriptor.risk] >= RISK_ORDER.write || descriptor.requiresApprovalForAgents)) {
      if (!options.approvalId) {
        const request = this.approvals.request({
          cell: cellId,
          tool: name,
          actor: actor.id,
          reason: options.reason ?? `الوكيل "${actor.id}" يطلب تنفيذ "${name}"`,
          payload: sanitize(input),
        });
        this.publish("kernel.approval.requested", "kernel", { approvalId: request.id, tool: name, cell: cellId, actor: actor.id });
        return {
          status: "pending_approval",
          tool: name,
          cell: cellId,
          risk: descriptor.risk,
          approvalId: request.id,
          reason: request.reason,
        };
      }
      // التحقق من التصريح **قبل** استهلاكه: التصريح لأداة أخرى يُرفض
      // دون إتلاف حقّ الاستدعاء الصحيح (لا استهلاك عند الرفض).
      const approval = this.approvals.get(options.approvalId);
      if (!approval || approval.state !== "granted") {
        this.publish("kernel.call.rejected", "kernel", { tool: name, cell: cellId, reason: "approval.invalid" });
        return {
          status: "denied",
          tool: name,
          reason: `تصريح غير صالح أو مُستهلك مسبقًا: "${options.approvalId}" — كل تصريح يُستهلك مرة واحدة`,
        };
      }
      if (approval.tool !== name) {
        this.publish("kernel.call.rejected", "kernel", { tool: name, cell: cellId, reason: "approval.tool_mismatch" });
        return { status: "denied", tool: name, reason: `التصريح "${approval.id}" أُصدر لأداة أخرى ("${approval.tool}")` };
      }
      this.approvals.consume(approval.id);
      stamp = { id: approval.id, decidedBy: approval.decidedBy };

      /**
       * تفويض السلطة: العملية تُنفَّذ بسلطة الإنسان المُعتمِد لا بصلاحية الوكيل.
       * دور غير معروف ⇒ لا صلاحيات في `can()` ⇒ منع افتراضي (لا منح بالخطأ).
       */
      effectiveActor = {
        id: approval.decidedBy ?? actor.id,
        role: approval.decidedByRole ?? "UNKNOWN",
        kind: "human",
      };
      onBehalfOf = { ...actor };
    }

    const handler = record.cell.tools?.[name];
    if (typeof handler !== "function") {
      return { status: "error", tool: name, cell: cellId, code: "handler.missing", message: `لا مُنفِّذ للأداة "${name}"` };
    }

    const startedAt = this.options.now();
    const ctx: ToolContext = {
      actor: effectiveActor,
      input,
      config: record.config,
      require: (capability) => this.require(capability),
      emit: (type, payload) => this.publish(type, cellId, payload),
      ...(stamp ? { approval: stamp } : {}),
      ...(onBehalfOf ? { onBehalfOf } : {}),
    };

    try {
      const value = await handler(ctx);
      const ms = this.options.now() - startedAt;
      this.publish("kernel.tool.called", "kernel", {
        tool: name,
        cell: cellId,
        risk: descriptor.risk,
        actor: effectiveActor.id,
        kind: effectiveActor.kind,
        ...(onBehalfOf ? { on_behalf_of: onBehalfOf.id, approval: stamp?.id ?? "" } : {}),
        ms,
      });
      return { status: "ok", tool: name, cell: cellId, risk: descriptor.risk, value, ms };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof KernelContractError ? err.code : "tool.threw";
      record.lastError = message;
      this.failures += 1;
      this.publish("kernel.cell.failed", "kernel", {
        cell: cellId,
        phase: "tool",
        tool: name,
        reason: message,
      });
      return { status: "error", tool: name, cell: cellId, code, message };
    }
  }

  /* ------------------------------------------------------------ مراقبة */

  /** صورة حيّة كاملة — تُغذّي الواجهة والوكلاء والوثائق. */
  snapshot(): KernelSnapshot {
    const cells = [...this.records.values()].map((r) => this.view(r));
    const stats = {
      total: cells.length,
      active: cells.filter((c) => c.state === "active").length,
      degraded: cells.filter((c) => c.state === "degraded").length,
      blocked: cells.filter((c) => c.state === "blocked").length,
      retired: cells.filter((c) => c.state === "retired").length,
      swaps: cells.reduce((sum, c) => sum + c.swaps, 0),
    };
    return {
      at: new Date(this.options.now()).toISOString(),
      cells,
      capabilities: [...this.capabilities.values()],
      events: this.bus.recent(30),
      stats,
    };
  }

  /** الوثائق الحيّة — تُغذّي مولّد README (مصدرها الـmanifest المُحمَّل فعليًا). */
  catalogue(): CellManifest[] {
    return [...this.records.values()]
      .filter((r) => r.state !== "retired")
      .map((r) => r.manifest);
  }

  onEvent(listener: (event: KernelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** نشر عام — للنواة فقط عمليًا (`source` مُقيَّد بالمعرّفات المسجَّلة). */
  publish(type: EventType, source: CellId | "kernel", payload: unknown): KernelEvent {
    const event: KernelEvent = {
      type,
      source,
      at: new Date(this.options.now()).toISOString(),
      payload,
    };
    this.bus.publish(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* مراقب معزول */
      }
    }
    return event;
  }

  get failureCount(): number {
    return this.failures;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** إعادة ضبط كاملة — للاختبارات ولبيئة التشغيل. */
  reset(): void {
    for (const record of this.records.values()) {
      try {
        record.cell.onUnmount?.();
      } catch {
        /* معزول */
      }
    }
    this.records.clear();
    this.capabilities.clear();
    this.routes.clear();
    for (const off of this.subscribers.values()) off();
    this.subscribers.clear();
    this.bus.clear();
    this.listeners.clear();
    this.started = false;
    this.failures = 0;
  }

  private view(record: Record_): CellRuntime {
    return {
      id: record.manifest.id,
      version: record.manifest.version,
      title: record.manifest.title,
      corner: record.manifest.corner,
      state: record.state,
      provides: [...record.manifest.provides],
      requires: [...record.manifest.requires],
      emits: [...record.manifest.emits],
      consumes: [...record.manifest.consumes],
      tools: [...record.tools.keys()],
      config: record.config,
      health: record.health,
      mountedAt: record.mountedAt,
      lastError: record.lastError,
      swaps: record.swaps,
    };
  }
}

/** يُزيل بيانات حسّاسة من الحمولة قبل حفظها في طلب موافقة. */
function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = /password|secret|token/i.test(key) ? "***" : value;
  }
  return out;
}

export type { ApprovalRequest };


