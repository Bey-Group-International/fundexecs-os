// lib/treasury/transfers.test.ts
// Unit tests for the pure transfer validation + status machine. No DB, no key.
import {
  validateTransfer,
  canTransition,
  isTerminal,
  mapStripePaymentIntentStatus,
  mapStripePayoutStatus,
  DEFAULT_LIMITS,
} from "@/lib/treasury/transfers";

const activeAcct = { status: "active" as const, balance_cents: 100_000 };

describe("validateTransfer", () => {
  it("accepts a well-formed deposit", () => {
    const r = validateTransfer({ direction: "deposit", amountCents: 25_000, account: activeAcct });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects non-positive or non-integer amounts", () => {
    expect(validateTransfer({ direction: "deposit", amountCents: 0, account: activeAcct }).ok).toBe(false);
    expect(validateTransfer({ direction: "deposit", amountCents: -5, account: activeAcct }).ok).toBe(false);
    expect(validateTransfer({ direction: "deposit", amountCents: 10.5, account: activeAcct }).ok).toBe(false);
  });

  it("enforces min and max limits", () => {
    const below = validateTransfer({ direction: "deposit", amountCents: 50, account: activeAcct });
    expect(below.errors.join(" ")).toMatch(/Minimum/);
    const above = validateTransfer({
      direction: "deposit",
      amountCents: DEFAULT_LIMITS.maxCents + 1,
      account: activeAcct,
    });
    expect(above.errors.join(" ")).toMatch(/Maximum/);
  });

  it("requires a selected, active account", () => {
    expect(validateTransfer({ direction: "deposit", amountCents: 1000, account: null }).errors.join(" ")).toMatch(
      /Select a linked account/,
    );
    const disc = validateTransfer({
      direction: "deposit",
      amountCents: 1000,
      account: { status: "disconnected", balance_cents: 100_000 },
    });
    expect(disc.errors.join(" ")).toMatch(/isn’t active/);
  });

  it("blocks a withdrawal that exceeds the account balance", () => {
    const r = validateTransfer({ direction: "withdrawal", amountCents: 200_000, account: activeAcct });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/exceeds/);
  });

  it("allows a deposit larger than balance (funds are being pulled in)", () => {
    const r = validateTransfer({ direction: "deposit", amountCents: 200_000, account: activeAcct });
    expect(r.ok).toBe(true);
  });
});

describe("canTransition / isTerminal", () => {
  it("permits the forward lifecycle", () => {
    expect(canTransition("pending", "processing")).toBe(true);
    expect(canTransition("processing", "succeeded")).toBe(true);
    expect(canTransition("pending", "canceled")).toBe(true);
  });

  it("forbids moving out of a terminal state", () => {
    expect(canTransition("succeeded", "processing")).toBe(false);
    expect(canTransition("failed", "succeeded")).toBe(false);
    expect(canTransition("canceled", "pending")).toBe(false);
  });

  it("flags terminal states", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("processing")).toBe(false);
  });
});

describe("Stripe status mapping", () => {
  it("maps PaymentIntent statuses (deposit rail)", () => {
    expect(mapStripePaymentIntentStatus("succeeded")).toBe("succeeded");
    expect(mapStripePaymentIntentStatus("processing")).toBe("processing");
    expect(mapStripePaymentIntentStatus("canceled")).toBe("canceled");
    expect(mapStripePaymentIntentStatus("requires_payment_method")).toBe("pending");
  });

  it("maps Payout statuses (withdrawal rail)", () => {
    expect(mapStripePayoutStatus("paid")).toBe("succeeded");
    expect(mapStripePayoutStatus("failed")).toBe("failed");
    expect(mapStripePayoutStatus("canceled")).toBe("canceled");
    expect(mapStripePayoutStatus("in_transit")).toBe("processing");
    expect(mapStripePayoutStatus("pending")).toBe("processing");
  });
});
