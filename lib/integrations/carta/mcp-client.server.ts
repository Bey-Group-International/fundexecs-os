// lib/integrations/carta/mcp-client.server.ts
// Server-only client for Carta's MCP endpoint — how the DEPLOYED app reaches
// live Carta at runtime (this is distinct from any MCP connection a chat client
// holds). It speaks MCP's JSON-RPC 2.0 "tools/call" over plain HTTP via fetch,
// so there is NO new SDK dependency — fetch goes through the agent proxy and is
// trivially testable with an injected transport.
//
// Honesty discipline (mirrors the Composio client): with no CARTA_MCP_URL or no
// per-org token, `cartaMcpConfigForOrg` returns null and the proactive Carta
// source degrades to its modeled track_record fallback — never a fake success.
// The token is resolved per-org from the vault (org_secrets, key CARTA_MCP_TOKEN),
// falling back to a deploy-level env token.
//
// Two integration-specific values a human confirms against their Carta account:
//   - CARTA_MCP_URL   (the endpoint)
//   - the tool name + command used for a benchmark (env-overridable below)
// Everything else here is generic MCP plumbing.

import { getOrgSecret } from "@/lib/org-secrets";
import { getCartaAccessToken } from "./oauth.server";

const DEFAULT_TIMEOUT_MS = 20_000;

export const CARTA_MCP_URL_ENV = "CARTA_MCP_URL";
/** org_secrets.provider key for a per-org Carta MCP token (overrides env). */
export const CARTA_MCP_TOKEN_SECRET = "CARTA_MCP_TOKEN";

/** The MCP tool used for reads (Carta's read tool is `fetch`), env-overridable. */
export const CARTA_MCP_TOOL = process.env.CARTA_MCP_TOOL ?? "fetch";

/** JSON-RPC response envelope (the subset we read). */
export interface CartaRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

/** Pluggable transport: POST a JSON-RPC body to the URL, resolve the response. */
export type CartaTransport = (
  url: string,
  body: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
) => Promise<{ status: number; text: string }>;

export interface CartaMcpConfig {
  url: string;
  token: string;
  transport?: CartaTransport;
  timeoutMs?: number;
}

export type CartaCallResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** True when a deploy-level Carta MCP endpoint is configured. */
export function cartaMcpUrlConfigured(): boolean {
  return Boolean(process.env[CARTA_MCP_URL_ENV]);
}

/**
 * Build the per-org Carta MCP config, or null when the endpoint or the token is
 * missing (caller then degrades to the modeled fallback). Token resolution: the
 * vaulted per-org token wins over a deploy-level env token.
 */
export async function cartaMcpConfigForOrg(
  orgId?: string,
  overrides: Partial<CartaMcpConfig> = {},
): Promise<CartaMcpConfig | null> {
  const url = overrides.url ?? process.env[CARTA_MCP_URL_ENV];
  if (!url) return null;

  // Token precedence: explicit override → durable OAuth client-credentials mint
  // (the primary path for the autonomous sweep) → a manually-pasted MCP token
  // (vault, then env) as a quick-demo fallback.
  let token = overrides.token;
  if (!token) {
    token = (await getCartaAccessToken(orgId)) ?? undefined;
  }
  if (!token && orgId) {
    try {
      token = (await getOrgSecret(orgId, CARTA_MCP_TOKEN_SECRET)) ?? undefined;
    } catch {
      // vault miss/decrypt error → fall back to env token
    }
  }
  token = token ?? process.env.CARTA_MCP_TOKEN ?? undefined;
  if (!token) return null;

  return { url, token, ...overrides };
}

/** Build the JSON-RPC 2.0 tools/call request body. Pure. */
export function buildToolCall(id: number, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

/**
 * Extract the JSON-RPC payload from a raw HTTP body. MCP's Streamable-HTTP
 * transport may reply as plain JSON or as an SSE `data: {...}` frame — handle
 * both. Pure + tested.
 */
export function extractRpcPayload(text: string): CartaRpcResponse | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // SSE framing: take the last `data:` line's JSON.
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const dataLines = trimmed
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    const last = dataLines[dataLines.length - 1];
    if (!last) return null;
    try {
      return JSON.parse(last) as CartaRpcResponse;
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(trimmed) as CartaRpcResponse;
  } catch {
    return null;
  }
}

/**
 * Pull the useful data out of a tool result: prefer MCP `structuredContent`,
 * else JSON-parse the first text content, else return the raw text string. Pure.
 */
export function parseToolResult<T = unknown>(rpc: CartaRpcResponse): CartaCallResult<T> {
  if (rpc.error) return { ok: false, error: rpc.error.message ?? "Carta MCP error" };
  const result = rpc.result;
  if (!result || result.isError) return { ok: false, error: "Carta tool reported an error." };
  if (result.structuredContent) return { ok: true, data: result.structuredContent as T };

  const text = result.content?.find((c) => c.type === "text" || c.text)?.text;
  if (text == null) return { ok: false, error: "Carta tool returned no content." };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: true, data: text as unknown as T };
  }
}

async function fetchTransport(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { method: "POST", headers, body, signal });
  return { status: res.status, text: await res.text() };
}

/**
 * Call one Carta MCP tool. Never throws: transport/network and tool-reported
 * failures all resolve to `{ ok:false }` so the caller can fall back cleanly.
 */
export async function callCartaTool<T = unknown>(
  config: CartaMcpConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CartaCallResult<T>> {
  const transport = config.transport ?? fetchTransport;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${config.token}`,
  };

  let signal: AbortSignal | undefined;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    signal = AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  try {
    const { status, text } = await transport(config.url, buildToolCall(1, toolName, args), headers, signal);
    if (status < 200 || status >= 300) {
      return { ok: false, error: `Carta MCP HTTP ${status}` };
    }
    const rpc = extractRpcPayload(text);
    if (!rpc) return { ok: false, error: "Unparseable Carta MCP response." };
    return parseToolResult<T>(rpc);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Carta MCP request failed." };
  }
}
