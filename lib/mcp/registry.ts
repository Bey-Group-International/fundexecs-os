// lib/mcp/registry.ts
// Pure validation + normalization for the custom MCP-server registry (the
// mcp_servers table, migration 20260714120000). No DB, no I/O, no React — so it
// can be imported by the RSC settings page, the "use server" action file, and
// unit tests alike, mirroring lib/mandate-options.ts.
//
// Scope is intentionally narrow: this validates the operator's submitted
// connection details for a REMOTE MCP server (streamable HTTP or SSE). It does
// not connect to the server or execute its tools.

// The remote transports the registry supports. Local stdio is deliberately
// excluded — a hosted deployment cannot spawn arbitrary processes.
export const MCP_TRANSPORTS = ["http", "sse"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  http: "Streamable HTTP",
  sse: "Server-Sent Events (SSE)",
};

// Bounds that keep a paste from bloating the row.
const MAX_NAME_LEN = 60;
const MAX_URL_LEN = 2048;
const MAX_HEADER_LEN = 64;
const DEFAULT_AUTH_HEADER = "Authorization";

// RFC 7230 token characters — the legal set for an HTTP header field name.
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  url: string;
  authHeader: string;
}

export type McpServerValidation =
  | { ok: true; value: McpServerInput }
  | { ok: false; error: string };

/** Narrow an arbitrary string to a supported transport. */
export function isMcpTransport(value: string): value is McpTransport {
  return (MCP_TRANSPORTS as readonly string[]).includes(value);
}

/**
 * True when `raw` parses as an absolute http(s) URL with a host. Rejects other
 * protocols (ws://, file://, javascript:, …) and relative/garbage input.
 */
export function isValidHttpUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return Boolean(parsed.hostname);
}

/**
 * Validate and normalize a submitted MCP-server registration. Trims text, fills
 * the default auth header, and enforces the transport/URL/name/header rules.
 * Returns a discriminated result so callers get either a clean, storable value
 * or a single operator-facing error message.
 */
export function normalizeMcpServerInput(raw: {
  name?: unknown;
  transport?: unknown;
  url?: unknown;
  authHeader?: unknown;
}): McpServerValidation {
  const name = String(raw.name ?? "").trim();
  if (!name) return { ok: false, error: "Give the server a name." };
  if (name.length > MAX_NAME_LEN) {
    return { ok: false, error: `Name must be ${MAX_NAME_LEN} characters or fewer.` };
  }

  const transport = String(raw.transport ?? "").trim();
  if (!isMcpTransport(transport)) {
    return { ok: false, error: "Choose a transport (HTTP or SSE)." };
  }

  const url = String(raw.url ?? "").trim();
  if (!url) return { ok: false, error: "Enter the server URL." };
  if (url.length > MAX_URL_LEN) return { ok: false, error: "That URL is too long." };
  if (!isValidHttpUrl(url)) {
    return { ok: false, error: "Enter a valid http(s) URL." };
  }

  // Auth header is optional in the form; default it, then validate the charset
  // so we never store a header name the transport layer would later reject.
  const authHeader = String(raw.authHeader ?? "").trim() || DEFAULT_AUTH_HEADER;
  if (authHeader.length > MAX_HEADER_LEN || !HEADER_NAME_RE.test(authHeader)) {
    return { ok: false, error: "Auth header name contains invalid characters." };
  }

  return { ok: true, value: { name, transport, url, authHeader } };
}
