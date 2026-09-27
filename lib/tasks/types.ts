/**
 * GEN-3 — أنواع المحرك (مستقل عن النواة: يستهلك `Repos` فقط).
 */
import type { Role } from "@/lib/authorization/roles";

/** العملية المدفوعة القانونية — خطوة تحملها تتطلب منحًا دائمًا (R6). */
export const PAID_OPERATION = "NEXA_A_PAID";

/** صلاحية طلب الموافقة الافتراضية: 15 دقيقة (نفس `ApprovalGate`). */
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

/** الفاعل عند المحرك — القرارات الحساسة تشترط `kind: "human"` (D4). */
export type TaskActor = {
  id: string;
  kind: "human" | "agent" | "system";
  role?: Role;
};

/** فاعل النظام الافتراضي — للانتقالات الآلية (يُدوَّن بأدنى صلاحية، بلا ادعاء سلطة). */
export const SYSTEM_TASK_ACTOR: TaskActor = { id: "task-engine", kind: "system" };

/** خطوة مخطَّطة كما يقدّمها المنظّم — المحرك يشتق الحالات منها ولا تُسند مباشرة. */
export type StepInput = {
  id: string;
  operation: string;
  costCap: number;
  requiresApproval?: boolean;
};

export type ApprovalDecision = "approved" | "rejected";

/** خطأ المحرك — `code` ثابت للفحص الآلي، والرسالة عربية للبشر. */
export class TaskEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskEngineError";
    this.code = code;
  }
}
