/**
 * Celia · core/agent · **الخطة** (GEN-2): تجزئة، ربط الوسائط بمخرجات خطوات سابقة، وفحص التوقّعات.
 * كل شيء هنا تصريحي وقابل للحفظ/الإعادة — لا دوال داخل الخطة.
 */
import { NexaError, canonicalJson, sha256Hex } from "../../nexa/index.ts";
import { isBinding, type Expectation, type Plan } from "../task/index.ts";

export const planHash = (p: Omit<Plan, "hash" | "id" | "createdAt">): string => sha256Hex(canonicalJson(p));

/** اختيار مسار: "a.b", "items[*].id" (يخرّط ويبسط مستوى واحدًا)، "[*]" على المصفوفة نفسها. */
export function selectPath(data: unknown, path: string): unknown {
  if (!path) return data;
  const segs = path.split(".").filter(Boolean);
  const walk = (v: unknown, i: number): unknown => {
    if (i >= segs.length) return v;
    const seg = segs[i]!;
    const star = seg.endsWith("[*]");
    const key = star ? seg.slice(0, -3) : seg;
    let next: unknown = v;
    if (key) {
      if (next === null || typeof next !== "object" || Array.isArray(next)) return undefined;
      next = (next as Record<string, unknown>)[key];
    }
    if (!star) return walk(next, i + 1);
    if (!Array.isArray(next)) return undefined;
    const out: unknown[] = [];
    for (const el of next) {
      const r = walk(el, i + 1);
      if (r === undefined) continue;
      if (Array.isArray(r) && i + 1 < segs.length) out.push(...r);
      else out.push(r);
    }
    return out;
  };
  return walk(data, 0);
}

/** يحلّ `{ $bind: "<stepId>.<path>" }` من بيانات خطوات مُتحقَّقة؛ ربط لا يُحلّ = خطأ، لا قيمة فارغة صامتة. */
export function resolveArguments(args: Record<string, unknown>, observations: Readonly<Record<string, unknown>>): { args: Record<string, unknown>; bound: string[] } {
  const bound: string[] = [];
  const resolve = (v: unknown, key: string): unknown => {
    if (isBinding(v)) {
      const dot = v.$bind.indexOf(".");
      const stepId = dot < 0 ? v.$bind : v.$bind.slice(0, dot);
      const path = dot < 0 ? "" : v.$bind.slice(dot + 1);
      if (!(stepId in observations)) throw new NexaError("BINDING_UNRESOLVED", `argument "${key}" binds to step "${stepId}" which has no verified observation`);
      let value = selectPath(observations[stepId], path);
      if (value === undefined || (Array.isArray(value) && value.length === 0)) throw new NexaError("BINDING_UNRESOLVED", `argument "${key}": path "${v.$bind}" is empty`);
      if (v.limit !== undefined && Array.isArray(value)) value = value.slice(0, v.limit);
      bound.push(key);
      return value;
    }
    if (Array.isArray(v)) return v.map((x, i) => resolve(x, `${key}[${i}]`));
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, resolve(x, `${key}.${k}`)]));
    return v;
  };
  return { args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, resolve(v, k)])), bound };
}

export function checkExpectation(exp: Expectation, obs: { ok: boolean; verified: boolean }, data: unknown): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if ((exp.ok ?? true) && !obs.ok) reasons.push("observation not ok");
  if (exp.verified && !obs.verified) reasons.push("gateway did not verify the observation against the proposal");
  for (const p of exp.has ?? []) if (selectPath(data, p) === undefined) reasons.push(`missing "${p}"`);
  if (exp.minCount) {
    const v = selectPath(data, exp.minCount.path);
    const n = Array.isArray(v) ? v.length : typeof v === "number" ? v : 0;
    if (n < exp.minCount.min) reasons.push(`"${exp.minCount.path}" count ${n} < ${exp.minCount.min}`);
  }
  return { ok: reasons.length === 0, reasons };
}
