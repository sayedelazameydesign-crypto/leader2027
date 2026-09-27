/**
 * AIsa — اختبار توصيل AISA_API_KEY (قراءة فقط · بلا أي نداء مدفوع).
 *
 *   AISA_API_KEY=… node scripts/aisa-key-check.mjs
 *
 * ثلاث طبقات، كلها مجانية بحسب وثائق AIsa (llms.txt: «/v1/models والاكتشاف مسموحان قبل أي موافقة»؛
 * كتالوج MCP: search/get_details/list_categories مجانية، وعملية `account` مجانية):
 *   REACH : GET https://api.aisa.one/v1/models بلا مفتاح  ⇒ يُتوقَّع 401 (الوصول + فرض المصادقة)
 *   REST  : GET https://api.aisa.one/v1/models بالمفتاح    ⇒ يُتوقَّع 200 (المفتاح صالح)
 *   MCP   : tools/call search (بلا مفتاح، مجاني) + tools/call use{operation_id:"account"} (بالمفتاح، مجاني)
 *
 * لا يُطبع المفتاح أبدًا ولا أي ترويسة Authorization ولا أي قيمة من ردّ الحساب — أرقام/أعلام/
 * أسماء حقول/معرّفات عمليات عامة فقط. بصمة المفتاح (أول 12 خانة من SHA-256) **محجوبة افتراضيًا** —
 * المستودع عام والتعليقات/الملخصات أثر عام، والبصمة معرّف ارتباط ثابت. للتحقق لمرة واحدة:
 * AISA_PRINT_FINGERPRINT=1، وقارن محليًا:  printf %s "$AISA_API_KEY" | sha256sum | cut -c1-12
 * كل الإخراج ASCII (تعليقات GitHub تُسقط غير ASCII).
 *
 * الخروج: 0 إذا المفتاح موجود وصالح (REST=200 أو MCP account مصادَق)؛ وإلا 1.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const OUT = process.env.L27_EVIDENCE_OUT ?? "";
const REST = "https://api.aisa.one/v1/models";
const MCP = "https://mcp.aisa.one/mcp";
const lines = [];
function say(section, text) {
  const line = `${section}: ${text}`.replace(/[^\x20-\x7E]/g, "?").slice(0, 600);
  lines.push(line);
  console.log(`::notice title=${section}::${line}`);
}

async function http(method, url, { headers = {}, body } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal, redirect: "manual" });
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();
    return { status: res.status, ct, text };
  } catch (err) {
    return { status: 0, ct: "", text: "", error: err instanceof Error ? err.name : "Error" };
  } finally {
    clearTimeout(t);
  }
}

/** JSON من ردّ JSON أو SSE (data: …) — بلا طباعة أي نص خام. */
function parseJson(res) {
  if (!res.text) return null;
  if (res.ct.includes("text/event-stream")) {
    const datas = res.text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    for (const d of datas.reverse()) { try { return JSON.parse(d); } catch { /* next */ } }
    return null;
  }
  try { return JSON.parse(res.text); } catch { return null; }
}

/** رمز خطأ فقط (لا رسائل حرّة). */
function errorCode(json) {
  const e = json?.error ?? json;
  if (!e || typeof e !== "object") return "n/a";
  return String(e.code ?? e.type ?? "n/a").slice(0, 40);
}

async function mcpCall(name, args, key) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
    "mcp-method": "tools/call",
    "mcp-name": name,
  };
  if (key) headers.authorization = `Bearer ${key}`;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args, _meta: { protocolVersion: "2025-06-18", clientCapabilities: {} } },
  });
  const res = await http("POST", MCP, { headers, body });
  const json = parseJson(res);
  let result = json?.result ?? null;
  // النتيجة إمّا structuredContent أو JSON داخل content[0].text
  let payload = result?.structuredContent ?? null;
  if (!payload && Array.isArray(result?.content)) {
    const txt = result.content.find((c) => c?.type === "text")?.text;
    if (typeof txt === "string") { try { payload = JSON.parse(txt); } catch { payload = null; } }
  }
  return { status: res.status, netError: res.error, json, result, payload, isError: Boolean(result?.isError) || Boolean(json?.error) };
}

// ---------------------------------------------------------------------------
const key = (process.env.AISA_API_KEY ?? "").trim();
let valid = false;
let rejected = false;

// 0) وجود المفتاح وشكله (بلا قيمة)
if (!key) {
  say("KEY", "AISA_API_KEY=absent (add it as a GitHub Actions secret - a dedicated low-spend-cap key - never via chat)");
} else {
  // البصمة معرّف ارتباط ثابت (correlation identifier) — تُطبع فقط عند طلب صريح لتحقق لمرة واحدة، لا في الأثر العام.
  const fp = process.env.AISA_PRINT_FINGERPRINT === "1"
    ? `sha256:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`
    : "withheld (set AISA_PRINT_FINGERPRINT=1 for a one-off check)";
  say("KEY", `AISA_API_KEY=present length=${key.length} prefix_ok=${key.startsWith("sk-aisa-") ? "yes" : "no"} fingerprint=${fp}`);
}

// 1) REACH — بلا مفتاح
{
  const r = await http("GET", REST);
  say("REACH", r.status === 0 ? `GET /v1/models -> network-error ${r.error}` : `GET /v1/models (no key) -> ${r.status} ${r.status === 401 ? "(auth enforced, as expected)" : ""}`.trim());
}

// 2) REST — بالمفتاح (مجاني: اكتشاف)
if (key) {
  const r = await http("GET", REST, { headers: { authorization: `Bearer ${key}` } });
  const j = parseJson(r);
  const n = Array.isArray(j?.data) ? j.data.length : Array.isArray(j) ? j.length : "n/a";
  if (r.status === 200) { valid = true; say("REST", `GET /v1/models (with key) -> 200 models=${n} => key VALID`); }
  else if (r.status === 401 || r.status === 403) { rejected = true; say("REST", `GET /v1/models (with key) -> ${r.status} error_code=${errorCode(j)} => key REJECTED`); }
  else say("REST", `GET /v1/models (with key) -> ${r.status || `network-error ${r.error}`} error_code=${errorCode(j)} => key ${r.status === 401 || r.status === 403 ? "REJECTED" : "UNVERIFIED"}`);
}

// 3) MCP — search مجاني بلا مفتاح (خط أساس الوصول للخادم)
{
  const s = await mcpCall("search", { query: "documentation page that teaches AI coding agents how to install and use AIsa API skills via the AIsa CLI", limit: 3 });
  if (s.status === 0) say("MCP", `search -> network-error ${s.netError}`);
  else {
    const cands = Array.isArray(s.payload?.candidates) ? s.payload.candidates : [];
    const ids = cands.map((c) => String(c?.operation_id ?? "?").slice(0, 60)).join(",");
    say("MCP", `search (no key, free) -> ${s.status} isError=${s.isError} error_code=${s.isError ? errorCode(s.json) : "n/a"} candidates=${cands.length}${ids ? ` operation_ids=[${ids}]` : ""}`);
  }
}

// 4) MCP — account مجاني بالمفتاح (يثبت أن الخادم يقبل المفتاح)
if (key) {
  const a = await mcpCall("use", { operation_id: "account" }, key);
  if (a.status === 0) say("MCP", `use(account) -> network-error ${a.netError}`);
  else {
    const ok = a.status === 200 && !a.isError;
    const keys = a.payload && typeof a.payload === "object" ? Object.keys(a.payload).slice(0, 12).join(",") : "n/a";
    say("MCP", `use(account, free) -> ${a.status} isError=${a.isError} error_code=${a.isError ? errorCode(a.json) : "n/a"} authenticated=${ok ? "yes" : "no"} result_fields=[${keys}] (values never printed)`);
    if (ok) valid = true;
    else if (a.status === 401 || a.status === 403) rejected = true;
  }
}

say("GATE", !key
  ? "BLOCKED: AISA_API_KEY absent (connectivity baseline only)"
  : valid ? "AISA_API_KEY connection OK"
  : rejected ? "AISA_API_KEY REJECTED by AIsa (401/403) - check key/revocation in console.aisa.one"
  : "AISA_API_KEY UNVERIFIED (network/other error - see lines above)");
if (OUT) writeFileSync(OUT, lines.join("\n") + "\n");
process.exit(key && valid ? 0 : 1);
