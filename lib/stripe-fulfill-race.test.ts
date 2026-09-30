/**
 * Fulfillment must grant exactly once, and must never report success without
 * granting.
 *
 * Regression test for a bug that reached production and gave real credits away.
 * Fulfillment has two callers — the browser's return redirect
 * (/api/stripe/return) and the Stripe webhook — and adding the webhook made
 * them concurrent for the first time. The very first live purchase was
 * fulfilled by both within 7ms and granted its 500-credit pack twice, because
 * the guard read `status` and then acted on it: both callers read "pending".
 *
 * The concurrency case drives two OVERLAPPING calls against one store, because
 * two sequential ones passed even with the bug. The remaining cases cover the
 * other half of the contract: a claim that could not be taken must not be
 * reported as "already fulfilled", or the grant is dropped and the webhook is
 * told to stop retrying.
 */

const grants: string[] = [];

// Claims live in processed_stripe_events (a bare text primary key). The one
// property that matters: a second insert of the same id conflicts, so only the
// first caller gets a row back.
const claims = new Set<string>();
let claimFails = false;

// The checkout audit row. Absent for invoice kinds, which the `kind` CHECK
// (plan|pack|gift) cannot store at all.
let checkoutRow: { status: string } | null = null;

function table(name: string) {
  if (name === "processed_stripe_events") {
    return {
      upsert: (row: { id: string }) => ({
        select: async () => {
          if (claimFails) return { data: null, error: { message: "db down" } };
          if (claims.has(row.id)) return { data: [], error: null };
          claims.add(row.id);
          return { data: [{ id: row.id }], error: null };
        },
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
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: checkoutRow }) }),
      }),
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

const retrieve = jest.fn(async () => ({
  id: "cs_live_race",
  payment_status: "paid",
  status: "complete",
  metadata: { org_id: "org_1", kind: "pack", pack_key: "pack_500" },
  customer: null,
  payment_intent: "pi_1",
}));
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({ checkout: { sessions: { retrieve } } })),
);

jest.mock("@/lib/purchase", () => ({
  addPack: jest.fn(async () => {
    grants.push("pack_500");
    return { ok: true };
  }),
}));

import { fulfillCheckout } from "./stripe";

beforeEach(() => {
  grants.length = 0;
  claims.clear();
  claimFails = false;
  checkoutRow = { status: "pending" };
  process.env.STRIPE_SECRET_KEY = "sk_live_test_fixture";
});

it("grants once when the webhook and the return redirect arrive together", async () => {
  const [a, b] = await Promise.all([
    fulfillCheckout("cs_live_race"),
    fulfillCheckout("cs_live_race"),
  ]);

  expect(grants).toHaveLength(1);
  // The winner succeeds; the loser must not surface an error to a buyer whose
  // payment genuinely went through, nor claim to have granted anything.
  const winner = [a, b].find((r) => !r.alreadyFulfilled);
  const loser = [a, b].find((r) => r.alreadyFulfilled);
  expect(winner?.ok).toBe(true);
  expect(loser?.ok).toBe(true);
  expect(checkoutRow?.status).toBe("fulfilled");
});

it("grants once when the same session is fulfilled twice in sequence", async () => {
  await fulfillCheckout("cs_live_race");
  await fulfillCheckout("cs_live_race");
  expect(grants).toHaveLength(1);
});

it("reports failure, not success, when the claim cannot be taken", async () => {
  claimFails = true;
  const res = await fulfillCheckout("cs_live_race");

  // The dangerous outcome is ok:true — it drops the grant and tells the webhook
  // to stop redelivering, so the buyer pays and receives nothing.
  expect(res.ok).toBe(false);
  expect(res.alreadyFulfilled).toBeUndefined();
  expect(grants).toHaveLength(0);
});

it("keeps retrying while another caller is mid-fulfillment", async () => {
  // Claim held, but the checkout is still pending: the holder has not finished.
  claims.add("fulfill:cs_live_race");
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(false);
  expect(res.alreadyFulfilled).toBeUndefined();
  expect(grants).toHaveLength(0);
});

it("reports already-fulfilled once the holder has finished", async () => {
  claims.add("fulfill:cs_live_race");
  checkoutRow = { status: "fulfilled" };
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(true);
  expect(res.alreadyFulfilled).toBe(true);
  expect(grants).toHaveLength(0);
});

it("does not strand an invoice checkout, which never has an audit row", async () => {
  claims.add("fulfill:cs_live_race");
  checkoutRow = null; // the kind CHECK cannot store invoice kinds
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(true);
  expect(res.alreadyFulfilled).toBe(true);
});
