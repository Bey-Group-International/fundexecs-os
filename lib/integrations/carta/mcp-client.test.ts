// Tests for the Carta MCP client — JSON-RPC plumbing, SSE/JSON parsing, and the
// never-throws contract. Pure pieces + an injected transport (no network).
import {
  buildToolCall,
  extractRpcPayload,
  parseToolResult,
  callCartaTool,
  type CartaTransport,
} from "./mcp-client.server";

describe("buildToolCall", () => {
  it("builds a JSON-RPC 2.0 tools/call body", () => {
    const body = JSON.parse(buildToolCall(1, "fetch", { command: "dwh:execute:question" }));
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "fetch", arguments: { command: "dwh:execute:question" } },
    });
  });
});

describe("extractRpcPayload", () => {
  it("parses plain JSON", () => {
    expect(extractRpcPayload('{"result":{"isError":false}}')).toEqual({ result: { isError: false } });
  });

  it("parses an SSE data: frame (last one wins)", () => {
    const sse = 'event: message\ndata: {"result":{"structuredContent":{"value":1.8}}}\n\n';
    expect(extractRpcPayload(sse)).toEqual({ result: { structuredContent: { value: 1.8 } } });
  });

  it("returns null on empty or unparseable input", () => {
    expect(extractRpcPayload("")).toBeNull();
    expect(extractRpcPayload("not json")).toBeNull();
  });
});

describe("parseToolResult", () => {
  it("prefers structuredContent", () => {
    const r = parseToolResult<{ value: number }>({ result: { structuredContent: { value: 1.8 } } });
    expect(r).toEqual({ ok: true, data: { value: 1.8 } });
  });

  it("JSON-parses text content when no structuredContent", () => {
    const r = parseToolResult({ result: { content: [{ type: "text", text: '{"value":2}' }] } });
    expect(r).toEqual({ ok: true, data: { value: 2 } });
  });

  it("returns raw text when content isn't JSON", () => {
    const r = parseToolResult({ result: { content: [{ type: "text", text: "hello" }] } });
    expect(r).toEqual({ ok: true, data: "hello" });
  });

  it("surfaces JSON-RPC errors and tool isError", () => {
    expect(parseToolResult({ error: { message: "boom" } })).toEqual({ ok: false, error: "boom" });
    expect(parseToolResult({ result: { isError: true } }).ok).toBe(false);
  });
});

describe("callCartaTool (injected transport)", () => {
  const cfg = { url: "https://carta.example/mcp", token: "t" };

  it("returns mapped data on a 200 with a structured result", async () => {
    const transport: CartaTransport = async () => ({
      status: 200,
      text: JSON.stringify({ result: { structuredContent: { value: 1.8, percentile: 85 } } }),
    });
    const r = await callCartaTool({ ...cfg, transport }, "fetch", { command: "x" });
    expect(r).toEqual({ ok: true, data: { value: 1.8, percentile: 85 } });
  });

  it("sends the bearer token and JSON-RPC body", async () => {
    let seen: { url: string; body: string; headers: Record<string, string> } | null = null;
    const transport: CartaTransport = async (url, body, headers) => {
      seen = { url, body, headers };
      return { status: 200, text: '{"result":{"structuredContent":{"value":1}}}' };
    };
    await callCartaTool({ ...cfg, transport }, "fetch", { command: "x" });
    expect(seen!.headers.Authorization).toBe("Bearer t");
    expect(JSON.parse(seen!.body).method).toBe("tools/call");
  });

  it("never throws — a network error becomes ok:false", async () => {
    const transport: CartaTransport = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await callCartaTool({ ...cfg, transport }, "fetch", {});
    expect(r).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("treats a non-2xx status as a failure", async () => {
    const transport: CartaTransport = async () => ({ status: 401, text: "unauthorized" });
    const r = await callCartaTool({ ...cfg, transport }, "fetch", {});
    expect(r.ok).toBe(false);
  });
});
