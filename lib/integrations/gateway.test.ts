import {
  envOnlyEvidence,
  resolveConnectedChannels,
  type ConnectionEvidence,
  type ConnectionRow,
} from "@/lib/integrations/gateway";

/** Evidence with just the named channels in one bucket. */
function evidence(over: Partial<ConnectionEvidence> = {}): ConnectionEvidence {
  return { env: new Set(), vault: new Set(), grants: new Set(), ...over };
}

describe("resolveConnectedChannels", () => {
  it("counts a channel configured deploy-wide", () => {
    expect(resolveConnectedChannels([], evidence({ env: new Set(["gmail"]) })).has("gmail")).toBe(true);
  });

  it("counts a channel with credentials in the org's vault", () => {
    expect(resolveConnectedChannels([], evidence({ vault: new Set(["calendly"]) })).has("calendly")).toBe(true);
  });

  it("counts a channel backed by somebody's OAuth grant", () => {
    const set = resolveConnectedChannels([], evidence({ grants: new Set(["google_calendar"]) }));
    expect(set.has("google_calendar")).toBe(true);
  });

  it("does NOT count a 'connected' row on its own", () => {
    // This is the bug. connectIntegration writes status 'connected' with a
    // mockAccountLabel and runs no handshake, so the row proves nothing — it is
    // how Google Calendar showed as connected against an empty vault, and how
    // dispatch came to believe it could route somewhere it cannot reach.
    const rows: ConnectionRow[] = [{ channel: "slack", status: "connected" }];
    expect(resolveConnectedChannels(rows, evidence()).has("slack")).toBe(false);
  });

  it("does not let a 'connected' row rescue a channel with no credentials", () => {
    const rows: ConnectionRow[] = [
      { channel: "google_calendar", status: "connected" },
      { channel: "calendly", status: "connected" },
    ];
    expect(resolveConnectedChannels(rows, evidence()).size).toBe(0);
  });

  it("still lets an explicit revoked row override real credentials", () => {
    // Disconnect was never the lie. A member who revokes a channel means it,
    // and the deploy env should not quietly put it back.
    const rows: ConnectionRow[] = [{ channel: "gmail", status: "revoked" }];
    expect(resolveConnectedChannels(rows, evidence({ env: new Set(["gmail"]) })).has("gmail")).toBe(false);
  });

  it("revokes across every kind of evidence", () => {
    const rows: ConnectionRow[] = [{ channel: "google_calendar", status: "revoked" }];
    const set = resolveConnectedChannels(
      rows,
      evidence({ grants: new Set(["google_calendar"]), vault: new Set(["google_calendar"]) }),
    );
    expect(set.has("google_calendar")).toBe(false);
  });

  it("leaves an unrelated channel's credentials alone", () => {
    const rows: ConnectionRow[] = [{ channel: "slack", status: "revoked" }];
    const set = resolveConnectedChannels(rows, evidence({ env: new Set(["docusign"]) }));
    expect(set.has("docusign")).toBe(true);
    expect(set.has("slack")).toBe(false);
  });
});

describe("envOnlyEvidence", () => {
  it("carries the deploy-wide set and claims nothing else", () => {
    const e = envOnlyEvidence(new Set(["gmail"]));
    expect(e.env.has("gmail")).toBe(true);
    expect(e.vault.size).toBe(0);
    expect(e.grants.size).toBe(0);
  });
});
