import {
  ACH_EXPECTED_DAYS,
  ROUTE_FACTS,
  chosenRoute,
  expectedClearingDate,
  offeredRoutes,
  failureMessage,
  isPermanentFailure,
  isSettlementStale,
  overdueRoute,
  preferredRoute,
  settlementSummary,
  type SettlementCapability,
} from "@/lib/native-payments";
import { NET_TERMS_DAYS } from "@/lib/subscription-invoices";

function cap(overrides: Partial<SettlementCapability> = {}): SettlementCapability {
  return { hasLinkedAccount: false, hasRemittance: false, hasCard: false, ...overrides };
}

describe("route selection", () => {
  it("prefers the rail that collects itself", () => {
    // A linked account beats printed wire instructions: nobody has to remember
    // to send anything.
    expect(preferredRoute(cap({ hasLinkedAccount: true, hasRemittance: true, hasCard: true })))
      .toBe("ach_debit");
  });

  it("prefers a transfer over a card", () => {
    expect(preferredRoute(cap({ hasRemittance: true, hasCard: true }))).toBe("transfer");
  });

  it("falls to a card only when no native rail exists", () => {
    expect(preferredRoute(cap({ hasCard: true }))).toBe("card");
  });

  it("reports honestly when there is no way to collect at all", () => {
    expect(preferredRoute(cap())).toBe("none");
  });
});

describe("overdue routing", () => {
  it("reaches for the card once the invoice is late", () => {
    expect(overdueRoute(cap({ hasLinkedAccount: true, hasCard: true }), { settlement_failure: null }))
      .toBe("card");
  });

  it("will try the bank once if no card exists and nothing has bounced", () => {
    expect(overdueRoute(cap({ hasLinkedAccount: true }), { settlement_failure: null }))
      .toBe("ach_debit");
  });

  it("does NOT re-ask a bank that already refused", () => {
    // A second debit against an account that returned the first one bounces
    // again and earns another return fee.
    expect(
      overdueRoute(cap({ hasLinkedAccount: true }), { settlement_failure: "Insufficient funds." }),
    ).toBe("none");
  });
});

describe("ACH timing", () => {
  it("expects a debit to clear within the usual window", () => {
    expect(expectedClearingDate(new Date("2026-09-01T00:00:00Z")).toISOString().slice(0, 10))
      .toBe(`2026-09-0${1 + ACH_EXPECTED_DAYS}`);
  });

  it("only calls a debit stale well past the point ACH is merely slow", () => {
    const started = { settlement_started_at: "2026-09-01T00:00:00.000Z" };
    expect(isSettlementStale(started, new Date("2026-09-08T00:00:00Z"))).toBe(false);
    expect(isSettlementStale(started, new Date("2026-09-12T00:00:00Z"))).toBe(true);
  });

  it("never calls a debit that was never submitted stale", () => {
    expect(isSettlementStale({ settlement_started_at: null }, new Date())).toBe(false);
  });
});

describe("failure classification", () => {
  it("treats a dead account as permanent and a dry one as temporary", () => {
    expect(isPermanentFailure("account_closed")).toBe(true);
    expect(isPermanentFailure("no_account")).toBe(true);
    expect(isPermanentFailure("debit_not_authorized")).toBe(true);
    // Money can arrive tomorrow; a closed account never will.
    expect(isPermanentFailure("insufficient_funds")).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
  });

  it("explains a bounce in terms of what the operator must do", () => {
    expect(failureMessage("insufficient_funds")).toMatch(/insufficient funds/i);
    expect(failureMessage("account_closed")).toMatch(/link another/i);
    expect(failureMessage("no_account")).toMatch(/re-link/i);
    // An unknown return code must still say something useful.
    expect(failureMessage("r99_unknown")).toMatch(/could not be collected/i);
  });
});

describe("what the operator is told", () => {
  const base = { status: "processing" as const, settlement_started_at: "2026-09-01T00:00:00.000Z", settlement_failure: null };

  it("says money is on its way, and when to expect it", () => {
    const line = settlementSummary(base, new Date("2026-09-02T00:00:00Z"));
    expect(line).toMatch(/Collecting from your linked account/);
    expect(line).toMatch(/September 6/);
  });

  it("admits when a collection is taking too long, without alarming", () => {
    const line = settlementSummary(base, new Date("2026-09-14T00:00:00Z"));
    expect(line).toMatch(/longer than usual/i);
    expect(line).toMatch(/nothing further is needed/i);
  });

  it("surfaces a bounce once the invoice is open again", () => {
    expect(
      settlementSummary({ status: "open", settlement_started_at: null, settlement_failure: "Your bank returned the payment for insufficient funds." }),
    ).toMatch(/insufficient funds/);
  });

  it("says nothing when there is nothing in flight", () => {
    expect(settlementSummary({ status: "open", settlement_started_at: null, settlement_failure: null })).toBeNull();
  });
});

// Letting the operator choose the rail, rather than being assigned one.
describe("choosing a rail", () => {
  it("honours the choice when it can actually be settled that way", () => {
    expect(chosenRoute(cap({ hasLinkedAccount: true, hasCard: true }), "card")).toBe("card");
  });

  it("falls back rather than failing every collection on a stale choice", () => {
    // Chose bank debit, then unlinked the account. Honouring the choice would
    // mean nothing ever collects again.
    expect(chosenRoute(cap({ hasCard: true }), "ach_debit")).toBe("card");
  });

  it("decides for an org that never expressed one", () => {
    expect(chosenRoute(cap({ hasLinkedAccount: true, hasCard: true }), null)).toBe("ach_debit");
  });

  it("only offers rails this deployment can complete", () => {
    // No remittance details configured, so a wire has nowhere to go — offering
    // it would make the paywall a dead end.
    const offered = offeredRoutes(cap({ hasLinkedAccount: true, hasCard: true }));
    expect(offered.map((r) => r.route)).toEqual(["ach_debit", "card"]);
  });

  it("offers nothing when nothing can settle", () => {
    expect(offeredRoutes(cap())).toEqual([]);
  });

  it("quotes speeds the engine actually honours", () => {
    // A promise in the UI that the sweep does not keep is worse than no promise.
    expect(ROUTE_FACTS.ach_debit.speed).toContain(String(ACH_EXPECTED_DAYS));
    expect(ROUTE_FACTS.transfer.speed).toContain(String(NET_TERMS_DAYS));
  });

  it("marks the transfer rail as the one that does not collect itself", () => {
    expect(ROUTE_FACTS.ach_debit.selfCollecting).toBe(true);
    expect(ROUTE_FACTS.card.selfCollecting).toBe(true);
    expect(ROUTE_FACTS.transfer.selfCollecting).toBe(false);
  });
});
