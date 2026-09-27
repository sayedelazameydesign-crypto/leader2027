/**
 * GEN-3 — ترجمة أخطاء المحرك إلى حالات HTTP (طبقة الـAPI وحدها تستعملها).
 *
 *  - 404: كيان غير موجود
 *  - 409: تعارض حالة (انتقال غير شرعي، قرار مكرر، خطوة بلا منح…)
 *  - 403: DENY أمني (عدم تطابق، استهلاك مكرر، قرار غير بشري…)
 *  - 400: تحقق مدخلات (§5، مقترح، سقف تكلفة، حكم…)
 */
import { TaskEngineError } from "./types";

export function taskErrorStatus(err: TaskEngineError): number {
  switch (err.code) {
    case "task.missing":
    case "approval.missing":
      return 404;
    case "approval.mismatch":
    case "approval.denied":
    case "approval.expired":
    case "approval.not_human":
    case "grant.consumed":
      return 403;
    case "task.state":
    case "task.state.unknown":
    case "task.transition.illegal":
    case "task.step.state":
    case "task.step.missing":
    case "task.plan.missing":
    case "task.plan.incomplete":
    case "task.needs_approval":
    case "task.integrity":
    case "approval.decided":
    case "approval.pending":
    case "grant.missing":
      return 409;
    default:
      return 400;
  }
}

/** مفتاح الخطأ في جسم الاستجابة — يُبقي `code` المحرك مرئيًا للعميل والوكيل. */
export function taskErrorBody(err: TaskEngineError): { errors: Record<string, string> } {
  return { errors: { [err.code]: err.message } };
}
