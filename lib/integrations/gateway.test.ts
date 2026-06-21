import { resolveConnectedChannels, type ConnectionRow } from "@/lib/integrations/gateway";

describe("resolveConnectedChannels", () => {
  it("includes the env-configured fallback channels", () => {
    const set = resolveConnectedChannels([], new Set(["gmail"]));
    expect(set.has("gmail")).toBe(true);
  });

  it("adds channels the org has connected through the gateway", () => {
    const rows: ConnectionRow[] = [{ channel: "slack", status: "connected" }];
    const set = resolveConnectedChannels(rows, new Set());
    expect(set.has("slack")).toBe(true);
  });

  it("lets an explicit revoked row override an env default", () => {
    const rows: ConnectionRow[] = [{ channel: "gmail", status: "revoked" }];
    const set = resolveConnectedChannels(rows, new Set(["gmail"]));
    expect(set.has("gmail")).toBe(false);
  });

  it("keeps an env default when the org has no row for it", () => {
    const rows: ConnectionRow[] = [{ channel: "slack", status: "connected" }];
    const set = resolveConnectedChannels(rows, new Set(["docusign"]));
    expect(set.has("docusign")).toBe(true);
    expect(set.has("slack")).toBe(true);
  });
});
