// lib/stake-dispute.test.ts
// Unit tests for the PURE dispute-outcome decision (no database). These pin down
// the due-process mapping (TOKENIZATION_LAYERS.md §9): an upheld dispute burns
// the stake, a dismissed one returns it, and an already-resolved dispute is
// inert — the guard that keeps resolveDispute idempotent so credits can never be
// double-moved.
import { stakeOutcomeForDispute } from "@/lib/stake-dispute";

describe("stakeOutcomeForDispute", () => {
  it("maps an upheld open dispute to a forfeiture (stake burned)", () => {
    expect(stakeOutcomeForDispute("open", "upheld")).toBe("forfeited");
  });

  it("maps a dismissed open dispute to a return (credits restored)", () => {
    expect(stakeOutcomeForDispute("open", "dismissed")).toBe("returned");
  });

  it("is inert for an already-upheld dispute, whatever the outcome", () => {
    expect(stakeOutcomeForDispute("upheld", "upheld")).toBeNull();
    expect(stakeOutcomeForDispute("upheld", "dismissed")).toBeNull();
  });

  it("is inert for an already-dismissed dispute, whatever the outcome", () => {
    expect(stakeOutcomeForDispute("dismissed", "upheld")).toBeNull();
    expect(stakeOutcomeForDispute("dismissed", "dismissed")).toBeNull();
  });
});
