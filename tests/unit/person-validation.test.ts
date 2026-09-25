import { describe, it, expect } from "vitest";
import {
  validatePersonInput,
  validatePersonPatch,
} from "@/lib/domain/people/person";
import {
  FORBIDDEN_POLITICAL_FIELDS,
  rejectPoliticalFields,
} from "@/lib/validation/sensitive";

describe("person validation", () => {
  it("يقبل صحيحاً ويطبيع الهاتف والمصدر", () => {
    const r = validatePersonInput({
      full_name: "  سيد العزامي  ",
      phone: "01012345678",
      source: "ميداني",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.full_name).toBe("سيد العزامي");
      expect(r.value.phone).toBe("01012345678");
      expect(r.value.region_id).toBeNull();
    }
  });

  it("يرفض اسماً قصيراً", () => {
    const r = validatePersonInput({ full_name: "س", source: "ميداني" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.full_name).toBeTruthy();
  });

  it("يرفض هاتفاً غير صالح", () => {
    const r = validatePersonInput({
      full_name: "اسم طويل",
      phone: "abc",
      source: "ميداني",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.phone).toBeTruthy();
  });

  it("يرفض غياب المصدر (وعي بالمصدر)", () => {
    const r = validatePersonInput({ full_name: "اسم طويل" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.source).toBeTruthy();
  });

  it("يرفض كل حقل سياسي محظور بالاسم (§5)", () => {
    for (const field of FORBIDDEN_POLITICAL_FIELDS) {
      const r = validatePersonInput({
        full_name: "اسم طويل",
        source: "ميداني",
        [field]: 5,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[field]).toContain("محظور");
    }
  });

  it("rejectPoliticalFields يكشف كل الحقول المحظورة", () => {
    const errors = rejectPoliticalFields({
      assumed_political_preference: "x",
      predicted_support: "y",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["assumed_political_preference", "predicted_support"].sort(),
    );
  });

  it("validatePersonPatch يقبل جزئياً ويرفض الحقول السياسية", () => {
    const r = validatePersonPatch({ phone: "01098765432" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.full_name).toBeUndefined();

    const bad = validatePersonPatch({ political_score: 10 });
    expect(bad.ok).toBe(false);
  });
});
