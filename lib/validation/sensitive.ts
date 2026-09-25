import type { FieldErrors } from "./result";

/**
 * Product Contract §5 — قيد مُلزِم:
 * لا حُقول انتماء/تفضيل/«درجة إقناع» سياسي في النواة،
 * ولا استنتاجها آلياً من السلوك. أي payload يحملها يُرفض صراحةً.
 */
export const FORBIDDEN_POLITICAL_FIELDS = [
  "assumed_political_preference",
  "predicted_support",
  "political_score",
  "persuadability_score",
] as const;

export function rejectPoliticalFields(input: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of FORBIDDEN_POLITICAL_FIELDS) {
    if (field in input) {
      errors[field] = "حقل محظور بموجب عقد المنتج §5: لا تفضيلات أو تقييمات سياسية";
    }
  }
  return errors;
}
