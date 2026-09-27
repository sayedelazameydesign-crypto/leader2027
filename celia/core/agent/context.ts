/**
 * Celia · core/agent · **السياق** (GEN-2): ما يعرفه الوكيل قبل أن يخطط — سجل القدرات، البوابة، الحدود، الحقائق المسبقة.
 *
 * السياق لا يحمل مفاتيح ولا اتصالات شبكية: البوابة هي الطريق الوحيد إلى أي مزوّد، والمحوّل هو من يعرف كيف يفكّ ناتجه.
 */
import { CAPABILITY_LADDER, type CapabilityRegistry, type CapabilityState, type DataClass, type ExecutionGateway, type Facts } from "../../nexa/index.ts";
import { MemoryCheckpointStore, type ApprovalService, type CheckpointStore, type Task, type TaskState, type TaskStore } from "../task/index.ts";

export type AgentLimits = {
  /** إعادات التخطيط القصوى للمهمة الواحدة. */
  maxReplans: number;
  /** إعادات المحاولة للمرشح نفسه عند فشل عابر. */
  maxRetriesPerStep: number;
  /** سقف صلب لمحاولات التنفيذ — ضمان الإنهاء. */
  maxAttempts: number;
};

export const DEFAULT_AGENT_LIMITS: AgentLimits = { maxReplans: 3, maxRetriesPerStep: 1, maxAttempts: 20 };

export type FailureClass = "transient" | "permanent";

export type AgentContext = {
  agentId: string;
  taskId: string;
  registry: CapabilityRegistry;
  gateway: ExecutionGateway;
  checkpoints: CheckpointStore;
  now: () => string;
  limits: AgentLimits;
  /** افتراضات الاقتراحات: تصنيف البيانات وسقف الإنفاق (0 = free-first). */
  defaults: { dataClass: DataClass; maxCostUsd: number };
  /** حقائق معروفة قبل التنفيذ (مثل secret_absent) — تدخل عقد النتيجة كما هي. */
  facts: Facts;
  /** يفكّ ناتج المزوّد إلى بيانات قابلة للفحص والربط (يعرّفه المحوّل). غيابه = الناتج كما هو. */
  parseResult?: (capability: string, result: unknown) => unknown;
  /** يصنّف فشل ملاحظة: عابر (يُعاد) أم دائم (يُعاد التخطيط). غيابه = دائم (fail-closed). */
  classifyFailure?: (capability: string, result: unknown) => FailureClass;
  /** عدّاد النقل الخام للمزوّد خارج البوابة — للإثبات transport_calls == executed. */
  transportCalls?: () => number;
  /** GEN-3: مخزن دائم — كل انتقال = معاملة (نقطة تفتيش + دليل + لقطة المهمة). غيابه = ذاكرة فقط (GEN-2). */
  store?: TaskStore;
  /** GEN-3: خدمة الموافقات — بوجودها يقف الوكيل في WAITING_APPROVAL بدل أن يُرفض عند APPROVAL. */
  approvals?: ApprovalService;
  /** مدة صلاحية طلب الموافقة بالمللي ثانية. */
  approvalTtlMs?: number;
  /** خطّاف بعد كل انتقال مُثبَّت (للاختبار/حقن الأعطال) — يُستدعى بعد الالتزام في المخزن. */
  onTransition?: (task: Task, to: TaskState) => void;
  /** وضع العملية الحالية: تشغيل جديد أم استئناف من المخزن. */
  mode: "run" | "resume";
};

export type AgentContextInit = Pick<AgentContext, "agentId" | "taskId" | "registry" | "gateway"> & Partial<Omit<AgentContext, "agentId" | "taskId" | "registry" | "gateway">>;

export function createAgentContext(init: AgentContextInit): AgentContext {
  return {
    checkpoints: new MemoryCheckpointStore(),
    now: () => new Date().toISOString(),
    limits: DEFAULT_AGENT_LIMITS,
    defaults: { dataClass: "PUBLIC", maxCostUsd: 0 },
    facts: {},
    mode: "run",
    ...init,
  };
}

export type CatalogEntry = { id: string; provider: string; state: CapabilityState; risk: string; costModel: string; availability: string };

/** ما يراه المخطِّط: القدرات المسجلة وحالتها على السلّم — لا أكثر. */
export function catalog(ctx: AgentContext): CatalogEntry[] {
  return ctx.registry.list().map((s) => ({ id: s.capability.id, provider: s.capability.provider, state: s.state, risk: s.capability.risk, costModel: s.capability.costModel, availability: s.capability.availability }));
}

export const ladderRank = (s: CapabilityState): number => CAPABILITY_LADDER.indexOf(s);
