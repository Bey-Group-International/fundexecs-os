import { IDENTITY_VALID_DAYS, identityOutcome } from "./lp-identity";

const NOW = Date.parse("2026-11-01T12:00:00Z");

describe("identityOutcome", () => {
  it("clears only on Stripe's verified, for a year", () => {
    const o = identityOutcome({ status: "approved", providerStatus: "verified" }, NOW);
    expect(o.state).toBe("verified");
    expect(o.check.status).toBe("clear");
    expect(o.check.checked_at).toBe("2026-11-01T12:00:00.000Z");
    expect(new Date(o.check.expires_at!).getTime() - NOW).toBe(IDENTITY_VALID_DAYS * 86_400_000);
    expect(o.check.summary).toMatch(/Compare the name/);
  });

  it("holds a verification that is being processed as pending, not clear", () => {
    const o = identityOutcome({ status: "pending", providerStatus: "processing" }, NOW);
    expect(o).toMatchObject({ state: "processing", check: { status: "pending", checked_at: null, expires_at: null } });
  });

  it("holds one waiting for the LP as pending", () => {
    const o = identityOutcome({ status: "pending", providerStatus: "requires_input" }, NOW);
    expect(o).toMatchObject({ state: "needs_input", check: { status: "pending", checked_at: null } });
    expect(o.check.summary).toMatch(/Waiting for the LP/);
  });

  it("reports a failed attempt without clearing, with a trimmed reason", () => {
    const o = identityOutcome({ status: "pending", providerStatus: "requires_input", notes: `  ${"x".repeat(500)}  ` }, NOW);
    expect(o.check.status).toBe("pending");
    expect(o.check.summary.startsWith("The last attempt did not pass: ")).toBe(true);
    expect(o.check.summary.length).toBeLessThan(260);
  });

  it("fails a canceled verification", () => {
    expect(identityOutcome({ status: "rejected", providerStatus: "canceled" }, NOW)).toMatchObject({ state: "canceled", check: { status: "failed", expires_at: null } });
  });

  it("never clears anything but an approved record", () => {
    for (const status of ["pending", "rejected", "expired"] as const) {
      expect(identityOutcome({ status, providerStatus: "verified" }, NOW).check.status).not.toBe("clear");
    }
  });
});
