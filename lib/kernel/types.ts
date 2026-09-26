/**
 * النواة الذرية — الأنواع والعقود (Atomic Kernel · Contracts)
 *
 * المبدأ الحاكم: **النواة لا تعرف شيئًا عن أي نواة ذرية (خلية)** —
 * انعكاس الاعتماد (IoC): كل خلية تُعرِّف نفسها وتُسجِّل نفسها،
 * والنواة لا تستورد أي ملف من `lib/cells` إطلاقًا.
 *
 * هذا الملف **مستقل عن النطاق**: لا يستورد شيئًا من domain/persistence/auth.
 */

/** معرّف النواة الذرية (الخلية). */
export type CellId = string;

/** معرّف قدرة — صيغة `namespace.action`، مثال: `people.read`. */
export type CapabilityId = string;

/** نوع حدث على الناقل. */
export type EventType = string;

export type Bilingual = { ar: string; en: string };

/** مستوى الخطورة — يُستعمل في بوابة الموافقات والأدوات. */
export type RiskLevel = "read" | "write" | "admin";

export const RISK_ORDER: Record<RiskLevel, number> = {
  read: 0,
  write: 1,
  admin: 2,
};

/**
 * الحالة الحياتية للنواة الذرية.
 *
 * declared → mounted → active
 *                  ↘ degraded   (فشل معزول — بقية الأنوية تواصل العمل)
 *                  ↘ blocked    (متطلَّب غير مُشبَع)
 * active  → retired            (تقاعدت بعد استبدال ساخن)
 */
export type LifecycleState =
  | "declared"
  | "mounted"
  | "active"
  | "degraded"
  | "blocked"
  | "retired";

export type Capability = {
  id: CapabilityId;
  label: Bilingual;
  risk: RiskLevel;
  /** الجهة التي أشبعت هذه القدرة: `kernel` أو معرّف خلية. */
  providedBy: string;
  /** الخدمة الفعلية المُشبِعة — ما يعيده `require(capability)`. */
  value?: unknown;
};

/** وصف أداة قابلة للاستدعاء — شكل متوافق مع وصف أدوات الوكلاء (MCP-shaped). */
export type ToolDescriptor = {
  /** اسم مؤهَّل: `<cell>.<tool>` */
  name: string;
  label: Bilingual;
  capability: CapabilityId;
  risk: RiskLevel;
  /** مخطط مُبسَّط للحقول: اسم الحقل → نوعه. */
  input: Record<string, string>;
  /**
   * أدوات الكتابة تُستدعى من **وكيل ذكاء اصطناعي**: تحتاج موافقة بشرية صريحة
   * قبل التنفيذ (Human-in-the-loop). استدعاء البشر لا يمرّ بهذه البوابة.
   */
  requiresApprovalForAgents: boolean;
};

/** مَقبض تعديل مستقل — «في كل ركن جزء» يمكن تغييره بلا لمس المعمارية. */
export type ConfigSlot = {
  key: string;
  label: Bilingual;
  default: string | number | boolean;
  /** وصف أثر التغيير — للتوثيق وللوكلاء. */
  effect: Bilingual;
};

export type CellManifest = {
  id: CellId;
  /** semver — الاستبدال الساخن يتحقق من التوافق. */
  version: string;
  title: Bilingual;
  /** الركن الذي تخدمه هذه النواة في النظام. */
  corner: string;
  summary: Bilingual;
  /** قدرات تُشبعها هذه النواة. */
  provides: CapabilityId[];
  /** قدرات تحتاجها — لا تُثبَّت قبل إشباعها. */
  requires: CapabilityId[];
  /** أحداث تنشرها. */
  emits: EventType[];
  /** أحداث تتلقاها — التواصل الوحيد المسموح بين الأنوية. */
  consumes: EventType[];
  tools: ToolDescriptor[];
  config: ConfigSlot[];
};

export type HealthReport = {
  ok: boolean;
  detail: string;
  at: string;
};

/** فاعل: بشري بجلسة، أو وكيل ذكاء اصطناعي. */
export type Actor = {
  id: string;
  role: string;
  kind: "human" | "agent";
};

export type ResolvedConfig = Readonly<Record<string, string | number | boolean>>;

/** أثر التصريح البشري على الاستدعاء — يُسجَّل في التدقيق (مساءلة). */
export type ApprovalStamp = {
  id: string;
  decidedBy: string | null;
};

export type ToolContext = {
  actor: Actor;
  input: Readonly<Record<string, unknown>>;
  config: ResolvedConfig;
  /** القدرات المُشبَعة — النواة الذرية لا تستورد خلية أخرى أبدًا. */
  require: <T = unknown>(capability: CapabilityId) => T;
  emit: (type: EventType, payload: unknown) => void;
  /** يُملأ فقط عند استدعاء وكيل بتصريح بشري مُستهلك. */
  approval?: ApprovalStamp;
  /**
   * هوية الطالب الأصلي عند تفويض السلطة.
   * عند اعتماد وكيل: `actor` = الإنسان المُعتمِد (صاحب السلطة) و`onBehalfOf` = الوكيل.
   * هكذا تُنفَّذ العملية بسلطة بشرية مُصرَّح بها، ويبقى أثر الطالب محفوظًا.
   */
  onBehalfOf?: Actor;
};

export type ToolHandler = (ctx: ToolContext) => unknown | Promise<unknown>;

export type MountContext = {
  config: ResolvedConfig;
  require: <T = unknown>(capability: CapabilityId) => T;
  emit: (type: EventType, payload: unknown) => void;
};

/**
 * النواة الذرية — الوحدة المكتفية ذاتيًا.
 *
 * عقد الاستقلال:
 *  1. لا تستورد خلية أخرى — التواصل عبر الناقل أو قدرات مُعلَنة.
 *  2. كل تعديل سلوكي يمرّ عبر `config` الخاصة بها وحدها.
 *  3. فشلها معزول: `degraded` ولا يُسقط بقية النظام.
 *  4. قابلية الاستبدال: `version` + `provides` هي عقد التوافق.
 */
export type Cell = {
  manifest: CellManifest;
  /**
   * **خدمات القدرات** — الواجهة الداخلية بين الأنوية.
   * لكل قدرة في `provides` خدمة هنا، وهذا ما يعيده `require(capability)`.
   * (الواجهة الخارجية للوكلاء والبشر هي `tools`.)
   */
  services?: Record<CapabilityId, unknown>;
  tools?: Record<string, ToolHandler>;
  health?: () => HealthReport | Promise<HealthReport>;
  onMount?: (ctx: MountContext) => void | Promise<void>;
  onUnmount?: () => void | Promise<void>;
  /**
   * يُنادى عند كل حدث مُعلَن في `consumes` — القناة الوحيدة للتفاعل بين الأنوية.
   * يُستعمل لبناء النوى **الحيّة**: إبطال ذاكرة مؤقتة، إعادة حساب، مزامنة حالة.
   */
  onEvent?: (event: KernelEvent, ctx: MountContext) => void | Promise<void>;
};

/** يُستعمل في ملفات الخلايا لتوثيق النية مع تحقق كامل من النوع. */
export function defineCell(cell: Cell): Cell {
  return cell;
}

export type KernelEvent = {
  type: EventType;
  source: CellId | "kernel";
  at: string;
  payload: unknown;
};

/** الصورة الحيّة لخلية — ما يراه المراقب/الوكيل. */
export type CellRuntime = {
  id: CellId;
  version: string;
  title: Bilingual;
  corner: string;
  state: LifecycleState;
  provides: CapabilityId[];
  requires: CapabilityId[];
  emits: EventType[];
  consumes: EventType[];
  tools: string[];
  config: ResolvedConfig;
  health: HealthReport | null;
  mountedAt: string | null;
  lastError: string | null;
  swaps: number;
};

export type KernelSnapshot = {
  at: string;
  cells: CellRuntime[];
  capabilities: Capability[];
  events: KernelEvent[];
  stats: {
    total: number;
    active: number;
    degraded: number;
    blocked: number;
    retired: number;
    swaps: number;
  };
};

/* ------------------------------------------------ بوابة الموافقات (2027) */

export type ApprovalState = "pending" | "granted" | "denied" | "consumed" | "expired";

/** طلب موافقة بشرية على فعل وكيل — وحدة المساءلة في النظام. */
export type ApprovalRequest = {
  id: string;
  cell: string;
  tool: string;
  actor: string;
  reason: string;
  input: Record<string, unknown>;
  requestedAt: string;
  state: ApprovalState;
  decidedBy: string | null;
  /** دور المُعتمِد لحظة القرار — أساس تفويض السلطة للوكيل. */
  decidedByRole: string | null;
  decidedAt: string | null;
  note: string | null;
};

/** خطأ النواة — يُرفع عند كسر عقد (تسجيل مكرر، استبدال غير متوافق…). */
export class KernelContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KernelContractError";
    this.code = code;
  }
}
