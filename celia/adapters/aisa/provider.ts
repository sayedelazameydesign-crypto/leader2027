/**
 * Celia · adapters/aisa · **المزوّد داخل حدّ التنفيذ** (GEN-1).
 *
 * الطريق الوحيد من بوابة NEXA إلى شبكة AIsa. يعرف أربع عمليات فقط، كلها مجانية وقراءة‑فقط بحسب العقد:
 *   list_categories · search (مع `anonymous:true` للمسبار الموثَّق بلا مفتاح) · get_details · use:account
 * أي عملية أخرى — وخاصةً `use:<operation_id>` المدفوعة — تُرفض **بنيويًا** قبل الشبكة (`PAID_USE_DISABLED`)،
 * حتى لو أخطأت البوابة. AISA paid execution = OFF BY DEFAULT.
 *
 * كل نداء شبكي خام يزيد عدّاد النقل؛ البوابة تعدّ تنفيذاتها؛ الفارق بينهما = نداءات خارج البوابة (يجب أن يكون 0).
 */
import { AisaPolicyError, accountSnapshot, callReadOnlyTool, createTransport, normalizePrice, type CallCounter, type McpResponse, type OperationDetails } from "./adapter.ts";
import { ProviderExecution, type Capability, type CapabilityRegistry, type ProviderResult } from "../../nexa/index.ts";

export const AISA_PROVIDER = "aisa.one";
export const AISA_CAPABILITY_VERSION = "mcp-2026-07-28";
/** العمليات المحكومة المجانية القرائية — الوحيدة التي يعرفها المزوّد. */
export const AISA_GOVERNED_OPERATIONS = ["list_categories", "search", "get_details", "use:account"] as const;
export type AisaGovernedOperation = (typeof AISA_GOVERNED_OPERATIONS)[number];

export const capabilityId = (operation: string): string => `aisa:${operation}`;

export function createAisaProvider(opts: { apiKey: string | null; fetchImpl?: typeof fetch; endpoint?: string; timeoutMs?: number }): { boundary: ProviderExecution; counter: CallCounter } {
  const counter: CallCounter = { calls: 0 };
  const anon = createTransport({ apiKey: null, fetchImpl: opts.fetchImpl, endpoint: opts.endpoint, timeoutMs: opts.timeoutMs, counter });
  const authed = createTransport({ apiKey: opts.apiKey, fetchImpl: opts.fetchImpl, endpoint: opts.endpoint, timeoutMs: opts.timeoutMs, counter });

  const boundary = new ProviderExecution("aisa-mcp", async (operation, args): Promise<ProviderResult> => {
    let r: McpResponse;
    switch (operation) {
      case "list_categories":
        r = await callReadOnlyTool(authed, "list_categories", {});
        break;
      case "search": {
        const { anonymous, ...rest } = args;
        r = await callReadOnlyTool(anonymous === true ? anon : authed, "search", rest);
        break;
      }
      case "get_details":
        r = await callReadOnlyTool(authed, "get_details", args);
        break;
      case "use:account":
        r = await accountSnapshot(authed);
        break;
      default:
        throw new AisaPolicyError(
          operation.startsWith("use:") ? "PAID_USE_DISABLED" : "TOOL_NOT_ALLOWED",
          operation.startsWith("use:") ? `paid use "${operation}" is disabled at the provider (GEN-1: OFF BY DEFAULT)` : `operation "${operation}" is not a governed AIsa operation`,
        );
    }
    return {
      ok: r.status === 200 && !r.isError,
      status: r.status,
      summary: `${operation}${args.anonymous === true ? "(anonymous)" : ""} -> ${r.status || `network-error ${r.networkError}`} isError=${r.isError} error_code=${r.errorCode}`,
      costUsd: 0,
      sideEffects: [],
      result: r,
    };
  });
  return { boundary, counter };
}

/** القدرات المجانية القرائية الأربع — CAN عند التسجيل؛ AVAILABLE لا تُمنح إلا بدليل مصادقة حقيقي. */
export function registerAisaCapabilities(registry: CapabilityRegistry): void {
  for (const op of AISA_GOVERNED_OPERATIONS) {
    registry.register({
      id: capabilityId(op),
      kind: "tool",
      provider: AISA_PROVIDER,
      risk: "read",
      costModel: "free",
      fixedCostUsd: 0,
      dataClearance: "INTERNAL",
      readOnly: true,
      version: AISA_CAPABILITY_VERSION,
      trust: "declared",
      availability: "known", // موثّق في الكتالوج ومُثبَت بالدليل في كل تشغيل (list_categories 200)
    });
  }
}

/** مرشح من `get_details` يصبح قدرة `aisa:use:<id>` بخصائصه المعلنة — ليحكم عليه NEXA قبل أي تنفيذ (الذي يبقى معطّلًا). */
export function candidateCapability(details: OperationDetails): Capability {
  const price = normalizePrice(details.price);
  const readOnly = details.read_only === true && (details.side_effects === undefined || details.side_effects === null || (Array.isArray(details.side_effects) && details.side_effects.length === 0) || details.side_effects === "none");
  const availability = String(details.availability ?? "").toLowerCase();
  return {
    id: capabilityId(`use:${details.operation_id}`),
    kind: "tool",
    provider: AISA_PROVIDER,
    risk: readOnly ? "read" : "write",
    costModel: price.kind,
    fixedCostUsd: price.kind === "fixed" ? price.usd : price.kind === "free" ? 0 : null,
    dataClearance: "INTERNAL",
    readOnly,
    version: "get_details",
    // trust = مصدر الوصف (الكتالوج يعلن)؛ availability = هل التوفّر معروف؟ "unknown" حرفيًا من المزوّد ⇒ unknown ⇒ NEXA_E_AVAILABILITY_UNKNOWN.
    trust: "declared",
    availability: /^(available|live|ok|ga|stable|active|online|enabled|ready|healthy)$/.test(availability) ? "known" : "unknown",
  };
}
