/**
 * A checkout that did not deliver must never be recorded as fulfilled.
 *
 * Every branch of fulfillCheckout runs only after Stripe confirmed payment, so
 * reaching markFulfillmentComplete without having done the work is a purchase
 * lost for good: the checkout reads "fulfilled", the webhook answers 200 and
 * Stripe stops redelivering, and the money is kept with nothing handed over.
 *
 * The plan branch did exactly that — it logged a failed startSubscription and
 * carried on — and four more branches did it by way of an `if (x) { … }` with
 * no else, so an unrecognised plan key, pack key or invoice id silently
 * fulfilled nothing. None of it had ever fired in production because no plan,
 * gift or invoice checkout had ever been paid.
 *
 * Each case here asserts the same three things, which together are what makes a
 * failure recoverable rather than terminal: the call fails, the completion
 * marker is absent, and the claim is released so Stripe's redelivery can retry.
 */

const claims = new Map<string, string>();
let checkoutRow: { status: string } | null = null;

let startResult: { ok: boolean; error?: string } = { ok: true };
let giftResult: { ok: boolean; error?: string } = { ok: true };
let settleResult: { ok: boolean; error?: string } = { ok: true };
let invoicePaidResult: { ok: boolean; error?: string } = { ok: true };
const effects: string[] = [];

function table(name: string) {
  if (name === "processed_stripe_events") {
    return {
      upsert: (row: { id: string }) => {
        const apply = () => {
          if (claims.has(row.id)) return { data: [], error: null };
          claims.set(row.id, new Date().toISOString());
          return { data: [{ id: row.id }], error: null };
        };
        return {
          select: async () => apply(),
          then: (resolve: (v: unknown) => void) => resolve(apply()),
        };
      },
      select: (cols?: string) => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            if (cols?.includes("created_at")) {
              const at = claims.get(id);
              return { data: at ? { id, created_at: at } : null, error: null };
            }
            return { data: claims.has(id) ? { id } : null, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_c: string, id: string) => {
          claims.delete(id);
          return { error: null };
        },
      }),
    };
  }
  if (name === "stripe_checkouts") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: checkoutRow }) }) }),
      update: (patch: { status?: string }) => ({
        eq: async () => {
          if (checkoutRow && patch.status) checkoutRow.status = patch.status;
          return { error: null };
        },
      }),
    };
  }
  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    insert: async () => ({ error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
    upsert: async () => ({ data: [], error: null }),
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: (n: string) => table(n) }),
}));

let metadata: Record<string, string> = {};
const retrieve = jest.fn(async () => ({
  id: "cs_live_incomplete",
  payment_status: "paid",
  status: "complete",
  metadata,
  customer: "cus_1",
  payment_intent: "pi_1",
}));
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve } },
    // The plan branch reads the saved card off the PaymentIntent. It swallows
    // its own failures by design, so stub it rather than let it log on every case.
    paymentIntents: { retrieve: async () => ({ payment_method: "pm_1" }) },
  })),
);

jest.mock("@/lib/purchase", () => ({
  addPack: jest.fn(async () => {
    effects.push("addPack");
  }),
}));
jest.mock("@/lib/subscriptions.server", () => ({
  startSubscription: jest.fn(async () => {
    effects.push("startSubscription");
    return startResult;
  }),
  savePaymentMethod: jest.fn(async () => {}),
  applySettledInvoices: jest.fn(async () => {}),
}));
jest.mock("@/lib/subscription-invoices.server", () => ({
  markInvoiceSettled: jest.fn(async () => {
    effects.push("markInvoiceSettled");
    return settleResult;
  }),
}));
jest.mock("@/lib/invoices.server", () => ({
  markInvoicePaid: jest.fn(async () => {
    effects.push("markInvoicePaid");
    return invoicePaidResult;
  }),
}));
jest.mock("@/lib/gift-earn", () => ({
  purchaseGift: jest.fn(async () => {
    effects.push("purchaseGift");
    return giftResult;
  }),
}));

import { fulfillCheckout } from "./stripe";

const SESSION = "cs_live_incomplete";

beforeEach(() => {
  // A dummy value so getStripe() is reachable; every Stripe call is mocked.
  process.env.STRIPE_SECRET_KEY = "sk_live_test_fixture";
  claims.clear();
  effects.length = 0;
  checkoutRow = { status: "pending" };
  startResult = { ok: true };
  giftResult = { ok: true };
  settleResult = { ok: true };
  invoicePaidResult = { ok: true };
  metadata = {};
  jest.clearAllMocks();
});

/** What must hold after any fulfillment that did not deliver. */
function expectRecoverable() {
  // Not recorded as done — the read-side fast path still says pending.
  expect(claims.has(`fulfilled:${SESSION}`)).toBe(false);
  expect(checkoutRow?.status).toBe("pending");
  // And the claim is gone, so a redelivery re-runs rather than no-opping.
  expect(claims.has(`fulfill:${SESSION}`)).toBe(false);
}

describe("fulfillment that delivers nothing", () => {
  it("fails a plan checkout whose plan key no longer exists", async () => {
    metadata = { org_id: "org_1", kind: "plan", plan_key: "retired_plan", interval: "annual" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/unknown plan key/);
    expect(effects).not.toContain("startSubscription");
    expectRecoverable();
  });

  it("fails a plan checkout when starting the subscription is refused", async () => {
    metadata = { org_id: "org_1", kind: "plan", plan_key: "starter", interval: "annual" };
    startResult = { ok: false, error: "wallet row missing" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/subscription start failed/);
    expect(effects).toContain("startSubscription");
    expectRecoverable();
  });

  it("fails a pack checkout whose pack key no longer exists", async () => {
    metadata = { org_id: "org_1", kind: "pack", pack_key: "pack_retired" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/unknown pack key/);
    expect(effects).not.toContain("addPack");
    expectRecoverable();
  });

  it("fails a gift checkout the gift engine refused", async () => {
    metadata = { org_id: "org_1", kind: "gift", pack_key: "pack_500", recipient_email: "x@y.com" };
    giftResult = { ok: false, error: "Enter a valid recipient email." };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/gift purchase failed/);
    expectRecoverable();
  });

  it("fails a subscription-invoice checkout carrying no invoice id", async () => {
    metadata = { org_id: "org_1", kind: "subscription_invoice" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/no subscription_invoice_id/);
    expect(effects).not.toContain("markInvoiceSettled");
    expectRecoverable();
  });

  it("fails a subscription-invoice checkout whose settle was refused", async () => {
    metadata = { org_id: "org_1", kind: "subscription_invoice", subscription_invoice_id: "inv_1" };
    settleResult = { ok: false, error: "already settled by another route" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/invoice settle failed/);
    expectRecoverable();
  });

  it("fails an invoice checkout whose update did not land", async () => {
    metadata = { org_id: "org_1", kind: "invoice", invoice_id: "pi_inv_1" };
    invoicePaidResult = { ok: false, error: "db down" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/invoice update failed/);
    expectRecoverable();
  });

  it("fails a checkout whose kind matches no branch", async () => {
    metadata = { org_id: "org_1", kind: "topup" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/unrecognised checkout kind/);
    expectRecoverable();
  });

  it("keeps a newline out of the message a failure detail can carry", async () => {
    metadata = { org_id: "org_1", kind: "plan", plan_key: "starter", interval: "annual" };
    startResult = { ok: false, error: "boom\nfake log line" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("\n") }),
    );
  });

  it("lets a retry succeed once the cause is gone, because the claim was released", async () => {
    metadata = { org_id: "org_1", kind: "plan", plan_key: "starter", interval: "annual" };
    startResult = { ok: false, error: "transient" };
    await expect(fulfillCheckout(SESSION)).rejects.toThrow(/subscription start failed/);
    expectRecoverable();

    // Stripe redelivers. Nothing is left holding the session, so this runs for real.
    startResult = { ok: true };
    const retry = await fulfillCheckout(SESSION);
    expect(retry.ok).toBe(true);
    expect(claims.has(`fulfilled:${SESSION}`)).toBe(true);
    expect(checkoutRow?.status).toBe("fulfilled");
  });
});

describe("fulfillment that does deliver", () => {
  it("still fulfils a good plan checkout", async () => {
    metadata = { org_id: "org_1", kind: "plan", plan_key: "starter", interval: "annual" };
    const res = await fulfillCheckout(SESSION);
    expect(res).toMatchObject({ ok: true, kind: "plan" });
    expect(effects).toContain("startSubscription");
    expect(claims.has(`fulfilled:${SESSION}`)).toBe(true);
  });

  it("still fulfils a good pack checkout", async () => {
    metadata = { org_id: "org_1", kind: "pack", pack_key: "pack_500" };
    const res = await fulfillCheckout(SESSION);
    expect(res).toMatchObject({ ok: true, kind: "pack" });
    expect(effects).toContain("addPack");
  });

  it("still fulfils a good invoice checkout", async () => {
    metadata = { org_id: "org_1", kind: "invoice", invoice_id: "pi_inv_1" };
    const res = await fulfillCheckout(SESSION);
    expect(res.ok).toBe(true);
    expect(effects).toContain("markInvoicePaid");
  });
});
