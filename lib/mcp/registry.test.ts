// lib/mcp/registry.test.ts
// Unit tests for the pure MCP-registry validation layer.
import {
  isMcpTransport,
  isValidHttpUrl,
  normalizeMcpServerInput,
  MCP_TRANSPORTS,
} from "@/lib/mcp/registry";

describe("isMcpTransport", () => {
  it("accepts the supported transports", () => {
    for (const t of MCP_TRANSPORTS) expect(isMcpTransport(t)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isMcpTransport("stdio")).toBe(false);
    expect(isMcpTransport("ws")).toBe(false);
    expect(isMcpTransport("")).toBe(false);
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http and https URLs with a host", () => {
    expect(isValidHttpUrl("https://mcp.example.com/sse")).toBe(true);
    expect(isValidHttpUrl("http://localhost:3000/mcp")).toBe(true);
  });
  it("rejects other protocols and garbage", () => {
    expect(isValidHttpUrl("ws://example.com")).toBe(false);
    expect(isValidHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("/relative/path")).toBe(false);
  });
});

describe("normalizeMcpServerInput", () => {
  it("normalizes a valid submission and defaults the auth header", () => {
    const result = normalizeMcpServerInput({
      name: "  Apollo MCP  ",
      transport: "http",
      url: "  https://mcp.apollo.io/  ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Apollo MCP",
        transport: "http",
        url: "https://mcp.apollo.io/",
        authHeader: "Authorization",
      },
    });
  });

  it("keeps a custom auth header", () => {
    const result = normalizeMcpServerInput({
      name: "Custom",
      transport: "sse",
      url: "https://x.dev/sse",
      authHeader: "X-Api-Key",
    });
    expect(result.ok && result.value.authHeader).toBe("X-Api-Key");
  });

  const invalidCases: Array<{ label: string; input: Record<string, unknown> }> = [
    { label: "empty name", input: { name: "", transport: "http", url: "https://x.dev" } },
    { label: "unknown transport", input: { name: "x", transport: "grpc", url: "https://x.dev" } },
    { label: "empty url", input: { name: "x", transport: "http", url: "" } },
    { label: "bad protocol", input: { name: "x", transport: "http", url: "ftp://x.dev" } },
    {
      label: "bad header",
      input: { name: "x", transport: "http", url: "https://x.dev", authHeader: "bad header!" },
    },
  ];
  it.each(invalidCases)("rejects invalid input ($label)", ({ input }) => {
    expect(normalizeMcpServerInput(input).ok).toBe(false);
  });

  it("rejects an over-long name", () => {
    expect(normalizeMcpServerInput({ name: "a".repeat(61), transport: "http", url: "https://x.dev" }).ok).toBe(
      false,
    );
  });
});
