/**
 * AIsa — محوّل قراءة‑فقط (read-only adapter). **يقترح ولا ينفّذ.**
 *
 *   connect → authenticate → list/search → get_details → validate schema → enforce max_price_usd → emit evidence
 *
 * حدود التصميم (NEXA rule: AI/AISA proposes → Policy decides → Authorization permits → Execution executes → Evidence verifies):
 *   - أدوات MCP المسموحة **بنيويًا**: `list_categories` · `search` · `get_details` (مجانية بحسب العقد).
 *     أي اسم آخر يُرفض قبل أي نداء شبكة (`AisaPolicyError TOOL_NOT_ALLOWED`) — `use`/`batch_use` غير قابلة للاستدعاء من هنا.
 *   - الاستثناء الوحيد والمُسمّى: `accountSnapshot()` = `use({operation_id:"account"})` — مجانية وقراءة‑فقط بحسب
 *     الكتالوج؛ الغرض الوحيد: فرق (delta) محاسبي قبل/بعد التشغيل كدليل «لا رسوم». `operation_id` ثابت في الكود.
 *   - قرار السياسة `ADMIT_TO_AUTHORIZATION` ليس تصريح تنفيذ؛ هو «مقبول للمرور إلى مرحلة التفويض» فقط.
 *   - السعر: مجاني أو ثابت وموثّق ≤ السقف ⇒ مقبول؛ ديناميكي/مجهول ⇒ رفض (وثائق AIsa: لا حدّ أعلى موثّق = لا تنفيذ).
 *   - الدليل ASCII منقّح: لا مفتاح، لا ترويسات، لا نصوص خام من الردود — رموز حالة/أعداد/أسماء حقول/معرّفات عمليات عامة.
 *
 * مستقل عن التطبيق: لا يستورده أي ملف في `app/` أو `lib/` (AISA_RUNTIME_INTEGRATION = NOT_PRESENT عمدًا).
 * يعمل مباشرة بـNode ≥ 22.18 (type stripping) — بنية TypeScript قابلة للمحو فقط (لا enum/namespace/parameter properties).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AISA_MCP_ENDPOINT = "https://mcp.aisa.one/mcp";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const READ_ONLY_TOOLS = ["list_categories", "search", "get_details"] as const;
export type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];

export class AisaPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AisaPolicyError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// النقل (transport)
// ---------------------------------------------------------------------------
export type Transport = {
  endpoint: string;
  apiKey: string | null;
  timeoutMs: number;
  fetchImpl: typeof fetch;
};

export function createTransport(opts: {
  apiKey?: string | null;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Transport {
  return {
    endpoint: opts.endpoint ?? AISA_MCP_ENDPOINT,
    apiKey: opts.apiKey ? opts.apiKey : null,
    timeoutMs: opts.timeoutMs ?? 20_000,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
}

export type McpResponse = {
  status: number;
  networkError: string | null;
  isError: boolean;
  errorCode: string;
  /** النتيجة المفكوكة (structuredContent أو JSON داخل content[0].text) — لا نص خام. */
  payload: unknown;
};

function parseBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (contentType.includes("text/event-stream")) {
    const datas = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    for (const d of datas.reverse()) {
      try {
        return JSON.parse(d);
      } catch {
        /* next */
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function codeOf(v: unknown): string {
  const r = asRecord(v);
  if (!r) return "n/a";
  const e = asRecord(r.error) ?? r;
  const c = e.code ?? e.type ?? e.status;
  return c === undefined || c === null ? "n/a" : String(c).slice(0, 40);
}

/** النداء الخام — خاص بالوحدة (غير مُصدَّر) حتى لا يمكن استدعاء `use` عشوائيًا من الخارج. */
async function rawToolsCall(t: Transport, name: string, args: Record<string, unknown>): Promise<McpResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    "mcp-method": "tools/call",
    "mcp-name": name,
  };
  if (t.apiKey) headers.authorization = `Bearer ${t.apiKey}`;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args, _meta: { protocolVersion: MCP_PROTOCOL_VERSION, clientCapabilities: {} } },
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), t.timeoutMs);
  try {
    const res = await t.fetchImpl(t.endpoint, { method: "POST", headers, body, signal: ac.signal, redirect: "manual" });
    const json = parseBody(await res.text(), res.headers.get("content-type") ?? "");
    const root = asRecord(json);
    const result = asRecord(root?.result);
    let payload: unknown = result?.structuredContent ?? null;
    if (payload === null && Array.isArray(result?.content)) {
      const first = result.content.find((c) => asRecord(c)?.type === "text");
      const txt = asRecord(first)?.text;
      if (typeof txt === "string") {
        try {
          payload = JSON.parse(txt);
        } catch {
          payload = null;
        }
      }
    }
    const isError = res.status >= 400 || Boolean(root?.error) || result?.isError === true;
    return { status: res.status, networkError: null, isError, errorCode: isError ? codeOf(json) : "n/a", payload };
  } catch (err) {
    return {
      status: 0,
      networkError: err instanceof Error ? err.name : "Error",
      isError: true,
      errorCode: "network",
      payload: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** الأدوات المجانية للقراءة فقط — أي اسم خارج القائمة يُرفض قبل الشبكة. */
export function callReadOnlyTool(t: Transport, name: ReadOnlyTool, args: Record<string, unknown>): Promise<McpResponse> {
  if (!(READ_ONLY_TOOLS as readonly string[]).includes(name)) {
    throw new AisaPolicyError("TOOL_NOT_ALLOWED", `tool "${String(name)}" is outside the read-only allowlist`);
  }
  return rawToolsCall(t, name, args);
}

/** الاستثناء المُسمّى الوحيد: لقطة الحساب (مجانية، قراءة‑فقط) — لأدلة «لا رسوم» قبل/بعد. */
export function accountSnapshot(t: Transport): Promise<McpResponse> {
  return rawToolsCall(t, "use", { operation_id: "account" });
}

// ---------------------------------------------------------------------------
// السياسة (pure — قابلة للاختبار بلا شبكة)
// ---------------------------------------------------------------------------
export type PriceNorm = { kind: "free" | "fixed" | "dynamic" | "unknown"; usd: number | null; source: string };

export function normalizePrice(price: unknown): PriceNorm {
  if (price === null || price === undefined) return { kind: "unknown", usd: null, source: "missing" };
  if (typeof price === "number" && Number.isFinite(price)) {
    return price <= 0 ? { kind: "free", usd: 0, source: "number" } : { kind: "fixed", usd: price, source: "number" };
  }
  if (typeof price === "string") {
    const s = price.toLowerCase();
    if (/\bfree\b|no charge/.test(s)) return { kind: "free", usd: 0, source: "string" };
    if (/dynamic|variable|varies|per (row|record|result|unit|1k|1000)/.test(s)) return { kind: "dynamic", usd: null, source: "string" };
    const m = s.match(/(?:\$|usd\s*)?(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      return n <= 0 ? { kind: "free", usd: 0, source: "string" } : { kind: "fixed", usd: n, source: "string" };
    }
    return { kind: "unknown", usd: null, source: "string" };
  }
  const r = asRecord(price);
  if (r) {
    const flag = String(r.kind ?? r.type ?? r.model ?? r.pricing_model ?? "").toLowerCase();
    if (/dynamic|variable|metered/.test(flag)) return { kind: "dynamic", usd: null, source: "object.kind" };
    if (/free/.test(flag) || r.free === true) return { kind: "free", usd: 0, source: "object.kind" };
    const currency = typeof r.currency === "string" ? r.currency.toUpperCase() : "USD";
    if (currency !== "USD") return { kind: "unknown", usd: null, source: "object.currency" };
    // حدّ أعلى موثّق يُفضَّل على السعر الاسمي (وثائق AIsa: التعرّض الأقصى الموثّق بالدولار).
    for (const k of ["max_usd", "max_price_usd", "max", "usd", "price_usd", "amount_usd", "per_call_usd", "per_call", "amount", "value"]) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        return v <= 0 ? { kind: "free", usd: 0, source: `object.${k}` } : { kind: "fixed", usd: v, source: `object.${k}` };
      }
      if (typeof v === "string") {
        const inner = normalizePrice(v);
        if (inner.kind !== "unknown") return { ...inner, source: `object.${k}` };
      }
    }
  }
  return { kind: "unknown", usd: null, source: typeof price };
}

export type JsonSchemaLike = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaLike;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchemaLike;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
};

export type SchemaCheck = { ok: boolean; errors: string[]; subset: true };

function typeOfValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/**
 * مُحقِّق مجموعة‑جزئية من JSON Schema: type · required · properties · additionalProperties · enum/const ·
 * items · minimum/maximum · minLength/maxLength · anyOf/oneOf. الكلمات الأخرى تُتجاهَل — لذلك `subset: true` دائمًا
 * في الدليل، ولا يُدَّعى تحقق كامل.
 */
export function validateArgs(schema: JsonSchemaLike | null | undefined, value: unknown, at = "$"): SchemaCheck {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object") return { ok: false, errors: [`${at}: no arguments_schema`], subset: true };

  if (schema.anyOf || schema.oneOf) {
    const branches = schema.anyOf ?? schema.oneOf ?? [];
    if (!branches.some((b) => validateArgs(b, value, at).ok)) errors.push(`${at}: matches none of ${branches.length} branches`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOfValue(value);
    const ok = allowed.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) errors.push(`${at}: expected ${allowed.join("|")}, got ${actual}`);
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${at}: not in enum`);
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${at}: != const`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: > maximum ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateArgs(schema.items, item, `${at}[${i}]`).errors));
  }
  const obj = asRecord(value);
  if (obj) {
    for (const req of schema.required ?? []) if (!(req in obj)) errors.push(`${at}.${req}: required`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) errors.push(...validateArgs(props[k], v, `${at}.${k}`).errors);
      else if (schema.additionalProperties === false) errors.push(`${at}.${k}: additional property not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateArgs(schema.additionalProperties, v, `${at}.${k}`).errors);
      }
    }
  }
  return { ok: errors.length === 0, errors, subset: true };
}

export type OperationDetails = {
  operation_id: string;
  arguments_schema?: JsonSchemaLike | null;
  read_only?: boolean;
  side_effects?: unknown;
  availability?: unknown;
  price?: unknown;
  known_pitfalls?: unknown;
};

export type Proposal = { operation_id: string; arguments: Record<string, unknown>; max_price_usd: number };

export type Policy = { maxPriceUsd: number; requireReadOnly: boolean; requireAvailable: boolean };
export const DEFAULT_POLICY: Policy = { maxPriceUsd: 0, requireReadOnly: true, requireAvailable: true };

export type Decision = {
  /** ADMIT_TO_AUTHORIZATION = مقبول للمرور إلى مرحلة التفويض — **ليس** تصريح تنفيذ. */
  decision: "ADMIT_TO_AUTHORIZATION" | "DENY";
  reasons: string[];
  checks: {
    schema: "pass" | "fail" | "missing";
    price: PriceNorm;
    price_within_cap: boolean;
    read_only: boolean | null;
    side_effects: "none" | "present" | "unknown";
    availability: "ok" | "not_ok" | "unknown";
  };
};

const AVAIL_OK = new Set(["available", "live", "ok", "up", "active", "operational", "healthy", "ga", "stable", "production", "public", "enabled", "online", "ready", "yes", "true", "beta", "preview"]);
const AVAIL_NOT_OK = new Set(["unavailable", "down", "disabled", "deprecated", "retired", "degraded", "maintenance", "offline", "no", "false", "coming_soon", "planned", "paused", "blocked", "restricted"]);

function availabilityOf(a: unknown): "ok" | "not_ok" | "unknown" {
  if (a === undefined || a === null) return "unknown";
  if (typeof a === "boolean") return a ? "ok" : "not_ok";
  const word = (w: string): "ok" | "not_ok" | "unknown" => {
    const x = w.toLowerCase().trim();
    return AVAIL_OK.has(x) ? "ok" : AVAIL_NOT_OK.has(x) ? "not_ok" : "unknown";
  };
  if (typeof a === "string") return word(a);
  const r = asRecord(a);
  if (r) {
    if (typeof r.available === "boolean") return r.available ? "ok" : "not_ok";
    if (typeof r.enabled === "boolean") return r.enabled ? "ok" : "not_ok";
    for (const k of ["status", "state", "tier", "stage", "level"]) if (typeof r[k] === "string") return word(r[k] as string);
  }
  return "unknown";
}

/** ملخص خام قصير لقيمة availability (بيانات كتالوج عامة) — لتشخيص المفردات غير المعروفة. */
export function availabilityRaw(a: unknown): string {
  if (a === undefined) return "undefined";
  if (a === null) return "null";
  if (typeof a === "string") return JSON.stringify(a.slice(0, 40));
  if (typeof a === "boolean" || typeof a === "number") return String(a);
  const r = asRecord(a);
  if (r) return `{${Object.entries(r).slice(0, 6).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.slice(0, 24)) : Array.isArray(v) ? `array(${v.length})` : typeof v === "object" && v !== null ? "object" : String(v)}`).join(",")}}`;
  return Array.isArray(a) ? `array(${a.length})` : typeof a;
}

function sideEffectsOf(s: unknown): "none" | "present" | "unknown" {
  if (s === undefined || s === null) return "unknown";
  if (typeof s === "boolean") return s ? "present" : "none";
  if (Array.isArray(s)) return s.length === 0 ? "none" : "present";
  if (typeof s === "string") return /^(none|no|false|read[-_ ]?only)?$/i.test(s.trim()) ? "none" : "present";
  return "unknown";
}

export function decide(details: OperationDetails, proposal: Proposal, policy: Policy = DEFAULT_POLICY): Decision {
  const reasons: string[] = [];
  if (details.operation_id !== proposal.operation_id) reasons.push("operation_id mismatch between details and proposal");

  const schemaCheck = validateArgs(details.arguments_schema, proposal.arguments);
  const schema: "pass" | "fail" | "missing" = !details.arguments_schema ? "missing" : schemaCheck.ok ? "pass" : "fail";
  if (schema !== "pass") reasons.push(...schemaCheck.errors.slice(0, 6).map((e) => `schema: ${e}`));

  const price = normalizePrice(details.price);
  const cap = Math.min(policy.maxPriceUsd, proposal.max_price_usd);
  let priceWithinCap = false;
  if (price.kind === "free") priceWithinCap = true;
  else if (price.kind === "fixed" && price.usd !== null) priceWithinCap = price.usd <= cap;
  if (!priceWithinCap) reasons.push(`price: ${price.kind}${price.usd !== null ? ` ${price.usd} USD` : ""} not within cap ${cap} USD`);
  if (proposal.max_price_usd > policy.maxPriceUsd) reasons.push(`price: proposal cap ${proposal.max_price_usd} exceeds policy cap ${policy.maxPriceUsd}`);

  const readOnly = typeof details.read_only === "boolean" ? details.read_only : null;
  const sideEffects = sideEffectsOf(details.side_effects);
  if (policy.requireReadOnly) {
    if (readOnly !== true) reasons.push(`read_only: ${readOnly === null ? "undeclared" : "false"}`);
    if (sideEffects === "present") reasons.push("side_effects: present");
  }

  const availability = availabilityOf(details.availability);
  if (policy.requireAvailable && availability !== "ok") reasons.push(`availability: ${availability}`);

  return {
    decision: reasons.length === 0 ? "ADMIT_TO_AUTHORIZATION" : "DENY",
    reasons,
    checks: { schema, price, price_within_cap: priceWithinCap, read_only: readOnly, side_effects: sideEffects, availability },
  };
}

// ---------------------------------------------------------------------------
// الدليل (evidence) — ASCII منقّح
// ---------------------------------------------------------------------------
export function sanitize(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("<redacted>");
  return out.replace(/[^\x20-\x7E]/g, "?").slice(0, 600);
}

export class Evidence {
  readonly lines: string[] = [];
  readonly facts: Record<string, unknown> = {};
  private readonly secrets: readonly string[];
  private readonly emit: (line: string) => void;
  constructor(secrets: readonly string[], emit: (line: string) => void = (l) => console.log(l)) {
    this.secrets = secrets;
    this.emit = emit;
  }
  /** notice=false ⇒ في ملف الدليل/الملخص فقط (GitHub يقصّ التعليقات عند 10 لكل خطوة). */
  say(section: string, text: string, notice = true): void {
    const line = sanitize(`${section}: ${text}`, this.secrets);
    this.lines.push(line);
    if (notice) this.emit(`::notice title=${section}::${line}`);
  }
  /** حقائق JSON منقّحة بنيويًا: التنقيح على الأوراق النصية فقط (لا قصّ للبنية). */
  fact(key: string, value: unknown): void {
    const redact = (v: unknown, depth: number): unknown => {
      if (depth > 12) return "<depth>";
      if (typeof v === "string") return sanitize(v, this.secrets);
      if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
      const r = asRecord(v);
      if (r) return Object.fromEntries(Object.entries(r).slice(0, 50).map(([k, x]) => [sanitize(k, this.secrets), redact(x, depth + 1)]));
      return v ?? null;
    };
    this.facts[key] = redact(value, 0);
  }
}

/** أوراق رقمية مُسطَّحة — للفرق المحاسبي قبل/بعد (أسماء مسارات وفروق فقط، لا قيم مطلقة). */
export function numericLeaves(v: unknown, prefix = "", out: Record<string, number> = {}): Record<string, number> {
  if (typeof v === "number" && Number.isFinite(v)) out[prefix || "$"] = v;
  else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[prefix || "$"] = Number(v);
  else if (Array.isArray(v)) v.forEach((x, i) => numericLeaves(x, `${prefix}[${i}]`, out));
  else {
    const r = asRecord(v);
    if (r) for (const [k, x] of Object.entries(r)) numericLeaves(x, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

export function numericDelta(before: unknown, after: unknown): { leaves: number; changed: Array<{ path: string; delta: number }> } {
  const a = numericLeaves(before);
  const b = numericLeaves(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: Array<{ path: string; delta: number }> = [];
  for (const k of keys) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d !== 0) changed.push({ path: k, delta: Number(d.toFixed(6)) });
  }
  return { leaves: keys.size, changed };
}

/**
 * استخراج تفاصيل العمليات من ردّ `get_details` أيًّا كان شكله: قائمة كائنات تحمل `operation_id`،
 * أو خريطة مفاتيحها معرّفات العمليات، أو كائن واحد، أو أي تغليف وسيط (`details`/`operations`/`results`…).
 */
export function extractDetails(payload: unknown, requestedIds: readonly string[]): OperationDetails[] {
  const found = new Map<string, OperationDetails>();
  const toDetails = (r: Record<string, unknown>, id: string): OperationDetails => ({
    operation_id: id,
    arguments_schema:
      (asRecord(r.arguments_schema) as JsonSchemaLike | null) ??
      (asRecord(r.input_schema) as JsonSchemaLike | null) ??
      (asRecord(r.parameters) as JsonSchemaLike | null),
    read_only: typeof r.read_only === "boolean" ? r.read_only : typeof r.readOnly === "boolean" ? r.readOnly : undefined,
    side_effects: r.side_effects ?? r.sideEffects,
    availability: r.availability,
    price: r.price ?? r.pricing ?? r.cost,
    known_pitfalls: r.known_pitfalls ?? r.pitfalls,
  });
  const visit = (v: unknown, depth: number): void => {
    if (depth > 5) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const r = asRecord(v);
    if (!r) return;
    if (typeof r.operation_id === "string") {
      if (!found.has(r.operation_id)) found.set(r.operation_id, toDetails(r, r.operation_id));
      return;
    }
    for (const [k, x] of Object.entries(r)) {
      const xr = asRecord(x);
      if (xr && requestedIds.includes(k) && typeof xr.operation_id !== "string") {
        if (!found.has(k)) found.set(k, toDetails(xr, k));
        continue;
      }
      visit(x, depth + 1);
    }
  };
  visit(payload, 0);
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// CLI — خط الأنابيب الكامل مع دليل runtime
// ---------------------------------------------------------------------------
type CliOptions = {
  query: string;
  category: string | null;
  limit: number;
  maxPriceUsd: number;
  args: Record<string, unknown> | null;
  autofill: boolean;
  accountSnapshot: boolean;
  out: string | null;
  json: string | null;
};

function parseCli(argv: string[]): CliOptions {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  let args: Record<string, unknown> | null = null;
  const rawArgs = get("--args");
  if (rawArgs) {
    const parsed: unknown = JSON.parse(rawArgs);
    args = asRecord(parsed);
    if (!args) throw new AisaPolicyError("BAD_ARGS", "--args must be a JSON object");
  }
  return {
    query: get("--query") ?? "documentation page that teaches AI coding agents how to install and use AIsa API skills via the AIsa CLI",
    category: get("--category"),
    limit: Math.min(10, Math.max(1, Number(get("--limit") ?? 3))),
    maxPriceUsd: Math.max(0, Number(get("--max-price-usd") ?? 0)),
    args,
    autofill: argv.includes("--autofill"),
    accountSnapshot: argv.includes("--account-snapshot"),
    out: get("--out"),
    json: get("--json"),
  };
}

const AUTOFILL_TEXT_KEYS = new Set(["query", "q", "text", "keyword", "keywords", "search", "prompt", "question"]);
const AUTOFILL_URL_KEYS = new Set(["url", "urls", "link", "website", "domain"]);
const AUTOFILL_URL = "https://aisa.one/docs/agent-skills";

/** تعبئة آلية لحقول query/url المطلوبة فقط — تُعلَن في الدليل (`autofilled=[…]`) ولا تُنفَّذ أبدًا. */
export function autofillArguments(schema: JsonSchemaLike | null | undefined, query: string): { args: Record<string, unknown>; filled: string[] } {
  const args: Record<string, unknown> = {};
  const filled: string[] = [];
  const props = schema?.properties ?? {};
  for (const key of schema?.required ?? []) {
    const p = props[key];
    const t = Array.isArray(p?.type) ? p?.type[0] : p?.type;
    const k = key.toLowerCase();
    if (AUTOFILL_TEXT_KEYS.has(k)) {
      args[key] = t === "array" ? [query] : query;
      filled.push(key);
    } else if (AUTOFILL_URL_KEYS.has(k)) {
      args[key] = t === "array" ? [AUTOFILL_URL] : k === "domain" ? "aisa.one" : AUTOFILL_URL;
      filled.push(key);
    }
  }
  return { args, filled };
}

export async function runPipeline(opts: CliOptions, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; evidence: Evidence }> {
  const key = (env.AISA_API_KEY ?? "").trim();
  const ev = new Evidence([key]);
  const gate: Record<string, string> = {
    AISA_SECRET_PRESENT: key ? "VERIFIED" : "ABSENT",
    AISA_MCP_AUTH: "NOT_VERIFIED",
    AISA_SEARCH_ANONYMOUS: "NOT_TESTED",
    AISA_DISCOVERY: "NOT_VERIFIED",
    AISA_GET_DETAILS: "NOT_VERIFIED",
    AISA_SCHEMA_VALIDATION: "subset",
    AISA_PRICE_CAP: `policy_max_usd=${opts.maxPriceUsd}`,
    AISA_PAID_USE: "NOT_EXECUTED",
    AISA_RUNTIME_INTEGRATION: "NOT_PRESENT (adapter is standalone; not imported by app/ or lib/)",
  };
  const useCalls: string[] = [];
  ev.say("ADAPTER", `read-only adapter; allowed tools=[${READ_ONLY_TOOLS.join(",")}] endpoint=${AISA_MCP_ENDPOINT}`, false);
  if (!key) ev.say("KEY", "AISA_API_KEY=absent (GitHub Actions secret; never via chat)");
  else ev.say("KEY", `AISA_API_KEY=present length=${key.length} prefix_ok=${key.startsWith("sk-aisa-") ? "yes" : "no"} (no fingerprint by default)`);

  const anon = createTransport({ apiKey: null, fetchImpl });
  const auth = createTransport({ apiKey: key || null, fetchImpl });

  // 0) لقطة حساب «قبل» (اختيارية، مجانية)
  let before: unknown = null;
  let beforeStatus = "n/a";
  if (key && opts.accountSnapshot) {
    const r = await accountSnapshot(auth);
    useCalls.push("account");
    before = r.payload;
    beforeStatus = `${r.status}${r.isError ? "!" : ""}`;
    ev.say("ACCOUNT", `snapshot before -> ${r.status} isError=${r.isError} (free, read-only; values never printed)`, false);
  }

  // 1) الوصول بلا مفتاح — سلوك الخادم الفعلي مقابل الكتالوج
  {
    const r = await callReadOnlyTool(anon, "search", { query: opts.query, limit: 1 });
    if (r.status === 0) ev.say("ANON", `search (no key) -> network-error ${r.networkError}`);
    else {
      gate.AISA_SEARCH_ANONYMOUS = r.status === 401 || r.status === 403 ? "CONTRADICTED_BY_RUNTIME" : r.status === 200 ? "AS_DOCUMENTED" : `HTTP_${r.status}`;
      ev.say("ANON", `search (no key) -> ${r.status} error_code=${r.errorCode} => ${gate.AISA_SEARCH_ANONYMOUS}`);
    }
  }
  if (!key) {
    ev.say("GATE", Object.entries(gate).map(([k, v]) => `${k}=${v}`).join(" "));
    return { ok: false, evidence: ev };
  }

  // 2) connect + authenticate — list_categories (مجاني)
  {
    const r = await callReadOnlyTool(auth, "list_categories", {});
    const p = asRecord(r.payload);
    const fields = p ? Object.keys(p).slice(0, 12).join(",") : "n/a";
    const counts = p
      ? Object.entries(p)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
          .join(" ")
      : "";
    if (r.status === 200 && !r.isError) gate.AISA_MCP_AUTH = "VERIFIED";
    else if (r.status === 401 || r.status === 403) gate.AISA_MCP_AUTH = "REJECTED";
    else gate.AISA_MCP_AUTH = r.status === 0 ? "NETWORK_ERROR" : `HTTP_${r.status}`;
    ev.say("AUTH", `list_categories (with key) -> ${r.status || `network-error ${r.networkError}`} isError=${r.isError} fields=[${fields}] ${counts}`.trim());
    ev.fact("list_categories", { status: r.status, fields, counts });
  }
  if (gate.AISA_MCP_AUTH !== "VERIFIED") {
    ev.say("GATE", Object.entries(gate).map(([k, v]) => `${k}=${v}`).join(" "));
    return { ok: false, evidence: ev };
  }

  // 3) search (مجاني)
  const searchArgs: Record<string, unknown> = { query: opts.query, limit: opts.limit };
  if (opts.category) searchArgs.category = opts.category;
  const s = await callReadOnlyTool(auth, "search", searchArgs);
  const sp = asRecord(s.payload);
  const candidates = Array.isArray(sp?.candidates) ? (sp?.candidates as unknown[]).map(asRecord).filter((c): c is Record<string, unknown> => c !== null) : [];
  const ids = candidates.map((c) => String(c.operation_id ?? "?").slice(0, 80));
  gate.AISA_DISCOVERY = s.status === 200 && !s.isError ? "VERIFIED" : `HTTP_${s.status}`;
  ev.say("SEARCH", `-> ${s.status} isError=${s.isError} retrieval_mode=${String(sp?.retrieval_mode ?? "n/a")} plan=${sp?.plan ? "yes" : "no"} candidates=${candidates.length} operation_ids=[${ids.join(",")}]`);
  ev.fact("search", { status: s.status, query: opts.query, operation_ids: ids });
  if (candidates.length === 0) {
    ev.say("GATE", Object.entries(gate).map(([k, v]) => `${k}=${v}`).join(" "));
    return { ok: gate.AISA_DISCOVERY === "VERIFIED", evidence: ev };
  }

  // 4) get_details (مجاني) — العقد الكامل للمرشحين (مستخرج مستقل عن شكل الردّ)
  const d = await callReadOnlyTool(auth, "get_details", { operation_ids: ids });
  const detailList = extractDetails(d.payload, ids);
  const dp = asRecord(d.payload);
  const dFields = dp ? Object.keys(dp).slice(0, 12).join(",") : Array.isArray(d.payload) ? `array(${d.payload.length})` : "n/a";
  gate.AISA_GET_DETAILS = d.status === 200 && !d.isError && detailList.length > 0 ? "VERIFIED" : `HTTP_${d.status}_parsed=${detailList.length}`;
  ev.say("DETAILS", `-> ${d.status} isError=${d.isError} fields=[${dFields}] parsed=${detailList.length}/${ids.length}`);
  for (const det of detailList) {
    const price = normalizePrice(det.price);
    const req = det.arguments_schema?.required ?? [];
    const pitfalls = Array.isArray(det.known_pitfalls) ? det.known_pitfalls.length : det.known_pitfalls ? 1 : 0;
    ev.say(
      "DETAILS",
      `${det.operation_id}: read_only=${det.read_only ?? "undeclared"} side_effects=${sideEffectsOf(det.side_effects)} availability=${availabilityOf(det.availability)}(raw:${availabilityRaw(det.availability)}) price=${price.kind}${price.usd !== null ? `:${price.usd}usd` : ""} required=[${req.join(",")}] pitfalls=${pitfalls}`,
      false,
    );
  }

  // 5) proposals (بلا تنفيذ) + 6) policy decision — لكل مرشح بترتيب البحث؛ الاقتراح المختار = أول مقبول وإلا الأول
  const policy: Policy = { ...DEFAULT_POLICY, maxPriceUsd: opts.maxPriceUsd };
  const evaluated: Array<{ proposal: Proposal; decision: Decision; filled: string[] }> = [];
  for (const id of ids) {
    const det = detailList.find((x) => x.operation_id === id);
    if (!det) continue;
    let args = opts.args ?? {};
    let filled: string[] = [];
    if (!opts.args && opts.autofill) ({ args, filled } = autofillArguments(det.arguments_schema, opts.query));
    const proposal: Proposal = { operation_id: id, arguments: args, max_price_usd: opts.maxPriceUsd };
    evaluated.push({ proposal, decision: decide(det, proposal, policy), filled });
  }
  const reasonCodes = (d: Decision): string => [...new Set(d.reasons.map((r) => r.split(":")[0].trim()))].join("+") || "-";
  if (evaluated.length > 0) {
    const chosen = evaluated.find((e) => e.decision.decision === "ADMIT_TO_AUTHORIZATION") ?? evaluated[0];
    const admitted = evaluated.filter((e) => e.decision.decision === "ADMIT_TO_AUTHORIZATION").length;
    gate.AISA_PRICE_CAP = `policy_max_usd=${opts.maxPriceUsd} admitted=${admitted}/${evaluated.length}`;
    ev.say("POLICY", `policy_max_usd=${opts.maxPriceUsd} ${evaluated.map((e) => `${e.proposal.operation_id}=${e.decision.decision === "DENY" ? `DENY(${reasonCodes(e.decision)})` : "ADMIT"}`).join(" ")}`);
    const c = chosen.decision.checks;
    ev.say("PROPOSAL", `chosen=${chosen.proposal.operation_id} decision=${chosen.decision.decision} arg_keys=[${Object.keys(chosen.proposal.arguments).join(",")}] autofilled=[${chosen.filled.join(",")}] max_price_usd=${chosen.proposal.max_price_usd} schema=${c.schema} price=${c.price.kind}${c.price.usd !== null ? `:${c.price.usd}usd` : ""} within_cap=${c.price_within_cap} read_only=${c.read_only ?? "undeclared"} side_effects=${c.side_effects} availability=${c.availability}${chosen.decision.reasons.length ? ` reasons=${chosen.decision.reasons.slice(0, 4).join(" | ")}` : ""} (proposal only; not executed)`);
    for (const e of evaluated) ev.say("POLICY", `${e.proposal.operation_id}: ${e.decision.decision}${e.decision.reasons.length ? ` reasons=${e.decision.reasons.slice(0, 6).join(" | ")}` : ""}`, false);
    ev.fact("proposals", evaluated.map((e) => ({ proposal: e.proposal, autofilled: e.filled, decision: e.decision })));
  }

  // 7) لقطة حساب «بعد» — الفرق المحاسبي (أسماء مسارات + فروق فقط)
  if (opts.accountSnapshot) {
    const r = await accountSnapshot(auth);
    useCalls.push("account");
    const delta = numericDelta(before, r.payload);
    const billing = delta.changed.filter((c) => /usage|spend|spent|cost|charge|balance|wallet|credit|amount|total/i.test(c.path));
    ev.say("ACCOUNT", `snapshot before -> ${beforeStatus} after -> ${r.status} numeric_leaves=${delta.leaves} changed=${delta.changed.length} billing_related_changed=${billing.length}${billing.length ? ` [${billing.map((c) => `${c.path}:${c.delta > 0 ? "+" : ""}${c.delta}`).slice(0, 8).join(",")}]` : ""} (free, read-only; values never printed)`);
    ev.fact("account_delta", { leaves: delta.leaves, changed: delta.changed.slice(0, 20) });
  }

  ev.say("USE", `paid_use_calls=0 free_use_calls=[${useCalls.join(",")}] (accountSnapshot is the only use this module can issue; operation_id is hard-coded)`);
  ev.say("GATE", Object.entries(gate).map(([k, v]) => `${k}=${v}`).join(" "));
  ev.fact("gate", gate);
  return { ok: gate.AISA_MCP_AUTH === "VERIFIED" && gate.AISA_DISCOVERY === "VERIFIED", evidence: ev };
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const { ok, evidence } = await runPipeline(opts, process.env);
  if (opts.out) writeFileSync(opts.out, evidence.lines.join("\n") + "\n");
  if (opts.json) writeFileSync(opts.json, JSON.stringify({ generated_at: new Date().toISOString(), facts: evidence.facts, lines: evidence.lines }, null, 2));
  process.exit(ok ? 0 : 1);
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.log(`::error title=ADAPTER::${err instanceof Error ? `${err.name}${"code" in err ? `(${String((err as { code?: unknown }).code)})` : ""}` : "Error"}`);
    process.exit(1);
  });
}
