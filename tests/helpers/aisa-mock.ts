/** بوابة AIsa MCP وهمية بالشكل الحقيقي الملاحظ في CI (anon ⇒ 401؛ availability "unknown"؛ use(account) مجاني). */
export const FAKE_AISA_KEY = "sk-aisa-TEST-0123456789abcdef0123456789abcdef";

export function mockAisaFetch(seen: Array<{ name: string; args: Record<string, unknown>; authed: boolean }> = []): typeof fetch {
  let uses = 0;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = JSON.parse(String(init?.body ?? "{}")) as { params?: { name?: string; arguments?: Record<string, unknown> } };
    const params = body.params ?? {};
    const authed = headers.authorization === `Bearer ${FAKE_AISA_KEY}`;
    seen.push({ name: String(params.name), args: params.arguments ?? {}, authed });
    const reply = (status: number, payload: unknown) =>
      new Response(
        JSON.stringify(status >= 400 ? { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "nope" } } : { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false } }),
        { status, headers: { "content-type": "application/json" } },
      );
    if (!authed) return reply(401, null);
    const schema = { type: "object", required: ["url"], properties: { url: { type: "string" } } };
    switch (params.name) {
      case "list_categories":
        return reply(200, { categories: [{ id: "search" }], servers: [1], toolCount: 581 });
      case "search":
        return reply(200, { retrieval_mode: "semantic", candidates: [{ operation_id: "post_tavily_crawl", input_schema: schema }, { operation_id: "post_firecrawl_scrape", input_schema: schema }] });
      case "get_details":
        return reply(200, {
          total_count: 2, success_count: 2, error_count: 0,
          results: [
            { operation_id: "post_tavily_crawl", arguments_schema: schema, read_only: true, side_effects: [], availability: "unknown", price: { usd: 0.24, currency: "USD" } },
            { operation_id: "post_firecrawl_scrape", arguments_schema: schema, read_only: true, side_effects: [], availability: "unknown", price: { usd: 0.001071, currency: "USD" } },
          ],
        });
      case "use":
        if (params.arguments?.operation_id === "account") {
          uses++;
          return reply(200, { data: { key: "sk-aisa-****cdef", balance_usd: 12.5, usage: { today_calls: 10 + uses, today_usd: 0 } } });
        }
        return reply(402, null);
      default:
        return reply(404, null);
    }
  }) as typeof fetch;
}
