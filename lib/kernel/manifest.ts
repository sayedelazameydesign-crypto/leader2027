/**
 * تحقق العقود + دمج المَقابض + توافق الاستبدال الساخن.
 *
 * كل رفض هنا **قبل** أي تشغيل: عقد مكسور = رفض صريح، لا فشل صامت لاحقًا.
 */
import {
  KernelContractError,
  RISK_ORDER,
  type CapabilityId,
  type Cell,
  type CellManifest,
  type ConfigSlot,
  type ResolvedConfig,
  type RiskLevel,
} from "./types";

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/;
const EVENT_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const RISKS: RiskLevel[] = ["read", "write", "admin"];

function isBilingual(value: unknown): value is { ar: string; en: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ar?: unknown }).ar === "string" &&
    typeof (value as { en?: unknown }).en === "string"
  );
}

function parseSemver(version: string): [number, number, number] | null {
  const m = SEMVER_PATTERN.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** تحقق كامل من عقد النواة الذرية (الخلية) — يرفع KernelContractError. */
export function validateCell(cell: Cell): void {
  if (!cell || typeof cell !== "object") {
    throw new KernelContractError("cell.invalid", "الخلية يجب أن تكون كائنًا");
  }
  const m = cell.manifest;

  if (!m || typeof m !== "object") {
    throw new KernelContractError("manifest.missing", "الخلية بلا manifest");
  }
  if (!ID_PATTERN.test(m.id)) {
    throw new KernelContractError(
      "manifest.id",
      `معرّف خلية غير صالح: "${m.id}" — المطلوب ^[a-z][a-z0-9-]*$`,
    );
  }
  if (!parseSemver(m.version)) {
    throw new KernelContractError(
      "manifest.version",
      `نسخة غير صالحة لـ"${m.id}": "${m.version}" — المطلوب semver مثل 1.0.0`,
    );
  }
  if (!isBilingual(m.title)) {
    throw new KernelContractError("manifest.title", `عنوان ثنائي اللغة مطلوب لـ"${m.id}"`);
  }
  if (!isBilingual(m.summary)) {
    throw new KernelContractError("manifest.summary", `ملخص ثنائي اللغة مطلوب لـ"${m.id}"`);
  }
  if (typeof m.corner !== "string" || m.corner.length === 0) {
    throw new KernelContractError("manifest.corner", `"${m.id}": الركن (corner) مطلوب`);
  }

  for (const list of ["provides", "requires"] as const) {
    const value = m[list];
    if (!Array.isArray(value)) {
      throw new KernelContractError("manifest." + list, `"${m.id}": ${list} يجب أن تكون مصفوفة`);
    }
    for (const cap of value) {
      if (typeof cap !== "string" || !CAPABILITY_PATTERN.test(cap)) {
        throw new KernelContractError(
          "manifest.capability",
          `"${m.id}": قدرة غير صالحة "${cap}" — المطلوب namespace.action أو namespace.section.action`,
        );
      }
    }
  }

  for (const list of ["emits", "consumes"] as const) {
    const value = m[list];
    if (!Array.isArray(value)) {
      throw new KernelContractError("manifest." + list, `"${m.id}": ${list} يجب أن تكون مصفوفة`);
    }
    for (const evt of value) {
      if (typeof evt !== "string" || !EVENT_PATTERN.test(evt)) {
        throw new KernelContractError(
          "manifest.event",
          `"${m.id}": حدث غير صالح "${evt}" — المطلوب namespace.event`,
        );
      }
    }
  }

  // خدمات القدرات: كل قدرة مُعلَنة لها خدمة فعلية — لا قدرة وهمية
  const services = cell.services ?? {};
  for (const capability of m.provides) {
    if (!(capability in services)) {
      throw new KernelContractError(
        "service.missing",
        `"${m.id}": القدرة "${capability}" مُعلَنة في provides بلا خدمة في cell.services`,
      );
    }
  }
  for (const capability of Object.keys(services)) {
    if (!m.provides.includes(capability)) {
      throw new KernelContractError(
        "service.undeclared",
        `"${m.id}": خدمة "${capability}" غير مُعلَنة في provides`,
      );
    }
  }

  // الأدوات: الوصف والمُنفِّذ يجب أن يتطابقا تمامًا (لا وصف بلا تنفيذ، ولا تنفيذ غير مُعلَن)
  const tools = m.tools ?? [];
  if (!Array.isArray(tools)) {
    throw new KernelContractError("manifest.tools", `"${m.id}": tools يجب أن تكون مصفوفة`);
  }
  const handlers = cell.tools ?? {};
  const declared = new Set<string>();
  for (const tool of tools) {
    if (typeof tool.name !== "string" || tool.name.length === 0) {
      throw new KernelContractError("tool.name", `"${m.id}": أداة بلا اسم`);
    }
    if (!tool.name.startsWith(`${m.id}.`)) {
      throw new KernelContractError(
        "tool.namespace",
        `"${m.id}": اسم الأداة "${tool.name}" يجب أن يبدأ بـ"${m.id}."`,
      );
    }
    if (declared.has(tool.name)) {
      throw new KernelContractError("tool.duplicate", `"${m.id}": أداة مكرّرة "${tool.name}"`);
    }
    declared.add(tool.name);
    if (!isBilingual(tool.label)) {
      throw new KernelContractError("tool.label", `"${tool.name}": عنوان ثنائي اللغة مطلوب`);
    }
    if (!CAPABILITY_PATTERN.test(tool.capability)) {
      throw new KernelContractError(
        "tool.capability",
        `"${tool.name}": قدرة غير صالحة "${tool.capability}"`,
      );
    }
    if (!m.provides.includes(tool.capability)) {
      throw new KernelContractError(
        "tool.capability.undeclared",
        `"${tool.name}": تستدعي قدرة "${tool.capability}" غير مُعلَنة في provides`,
      );
    }
    if (!RISKS.includes(tool.risk)) {
      throw new KernelContractError("tool.risk", `"${tool.name}": مستوى خطورة غير صالح`);
    }
    if (typeof tool.requiresApprovalForAgents !== "boolean") {
      throw new KernelContractError(
        "tool.approval",
        `"${tool.name}": requiresApprovalForAgents يجب أن تكون boolean`,
      );
    }
    if (tool.risk !== "read" && !tool.requiresApprovalForAgents) {
      throw new KernelContractError(
        "tool.approval.required",
        `"${tool.name}": كل أداة كتابة/إدارة يجب أن تتطلب موافقة الوكيل (بوابة 2027)`,
      );
    }
    if (typeof handlers[tool.name] !== "function") {
      throw new KernelContractError(
        "tool.handler.missing",
        `"${tool.name}": مُعلَنة بلا مُنفِّذ في cell.tools`,
      );
    }
  }
  for (const name of Object.keys(handlers)) {
    if (!declared.has(name)) {
      throw new KernelContractError(
        "tool.undeclared",
        `"${m.id}": مُنفِّذ "${name}" غير مُعلَن في manifest.tools`,
      );
    }
  }

  // مَقابض التعديل
  const config = m.config ?? [];
  const keys = new Set<string>();
  for (const slot of config) {
    if (typeof slot.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(slot.key)) {
      throw new KernelContractError("config.key", `"${m.id}": مفتاح إعداد غير صالح`);
    }
    if (keys.has(slot.key)) {
      throw new KernelContractError("config.duplicate", `"${m.id}": مفتاح مكرّر "${slot.key}"`);
    }
    keys.add(slot.key);
    const kind = typeof slot.default;
    if (kind !== "string" && kind !== "number" && kind !== "boolean") {
      throw new KernelContractError(
        "config.default",
        `"${m.id}.${slot.key}": القيمة الافتراضية يجب أن تكون string/number/boolean`,
      );
    }
    if (!isBilingual(slot.label) || !isBilingual(slot.effect)) {
      throw new KernelContractError(
        "config.label",
        `"${m.id}.${slot.key}": label و effect ثنائيا اللغة مطلوبان`,
      );
    }
  }
}

function applySlots(slots: ConfigSlot[]): ResolvedConfig {
  const out: Record<string, string | number | boolean> = {};
  for (const slot of slots) out[slot.key] = slot.default;
  return Object.freeze(out);
}

/**
 * دمج مَقابض الخلية مع تجاوزات التشغيل.
 *
 * صارم عمدًا: أي مفتاح غير مُعلَن ⇒ رفض. بهذا يستحيل أن يُغيّر إعدادُ نواةٍ
 * سلوكَ نواةٍ أخرى، ويبقى «لكل ركن جزؤه» مضمونًا بالتحقق لا بالانضباط.
 */
export function resolveConfig(manifest: CellManifest, overrides?: Record<string, unknown>): ResolvedConfig {
  const base = applySlots(manifest.config ?? []);
  if (!overrides) return base;

  const declared = new Set((manifest.config ?? []).map((s) => s.key));
  const merged: Record<string, string | number | boolean> = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    if (!declared.has(key)) {
      throw new KernelContractError(
        "config.unknown",
        `"${manifest.id}": مَقبض غير مُعلَن "${key}" — الأنوية تُعدَّل من مَقابضها المُعلَنة فقط`,
      );
    }
    const expected = typeof base[key];
    if (typeof value !== expected) {
      throw new KernelContractError(
        "config.type",
        `"${manifest.id}.${key}": النوع المتوقع ${expected} والمُعطى ${typeof value}`,
      );
    }
    merged[key] = value as string | number | boolean;
  }
  return Object.freeze(merged);
}

/**
 * توافق الاستبدال الساخن.
 *
 * شرطان: (1) النواة الجديدة تُشبع **كل** قدرات القديمة (لا كسر للمُستهلكين)،
 * (2) الرقم الرئيسي (major) نفسه والنسخة الجديدة ≥ القديمة.
 */
export function assertSwappable(current: CellManifest, next: CellManifest): void {
  if (current.id !== next.id) {
    throw new KernelContractError(
      "swap.id",
      `استبدال غير متوافق: "${current.id}" مقابل "${next.id}" — لا يمكن استبدال نواة بنواة أخرى`,
    );
  }
  const missing = current.provides.filter((cap) => !next.provides.includes(cap));
  if (missing.length) {
    throw new KernelContractError(
      "swap.capability",
      `"${next.id}"@${next.version} لا تُشبع قدرات "${current.id}"@${current.version}: [${missing.join(", ")}]`,
    );
  }
  const a = parseSemver(current.version);
  const b = parseSemver(next.version);
  if (!a || !b) {
    throw new KernelContractError("swap.version", `نسخة غير صالحة في الاستبدال ("${next.id}")`);
  }
  if (a[0] !== b[0]) {
    throw new KernelContractError(
      "swap.major",
      `"${next.id}": تغيير الرقم الرئيسي (${a[0]} → ${b[0]}) كسرٌ للعقد — يتطلب خلية جديدة بمعرّف جديد`,
    );
  }
  const cmp = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  if (cmp < 0) {
    throw new KernelContractError(
      "swap.downgrade",
      `"${next.id}": تراجع نسخة (${current.version} → ${next.version}) مرفوض`,
    );
  }
}

/** أعلى مستوى خطورة في قائمة أدوات — يُستعمل للتصنيف والعرض. */
export function highestRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (acc, level) => (RISK_ORDER[level] > RISK_ORDER[acc] ? level : acc),
    "read",
  );
}
