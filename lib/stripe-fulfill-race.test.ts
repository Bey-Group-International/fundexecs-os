/**
 * Fulfillment must grant exactly once, even when both paths arrive together.
 *
 * This is a regression test for a bug that reached production and gave real
 * credits away. Fulfillment has two callers — the browser's return redirect
 * (/api/stripe/return) and the Stripe webhook — and adding the webhook made
 * them concurrent for the first time. The very first live purchase was
 * fulfilled by both within 7ms and granted its 500-credit pack twice, because
 * the guard read `status` and then acted on it: both callers read "pending".
 *
 * The fix is a compare-and-set claim, so the test drives the thing that
 * actually broke — two overlapping calls against one store — rather than two
 * sequential ones, which passed even with the bug.
 */

const grants: string[] = [];

// A minimal stand-in for the checkout table that honours the ONE property the
// claim depends on: an UPDATE filtered on `status <> 'fulfilled'` matches a row
// for the first caller and nothing for the second.
const store = new Map<string, { status: string; kind: string }>();

function table(name: string) {
  if (name !== "stripe_checkouts") {
    // Every other table used during a pack grant: accept and record writes.
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ data: [], error: null }),
    };
  }
  let pendingUpdate: Record<string, unknown> | null = null;
  let sessionFilter = "";
  let requirePending = false;
  const api = {
    select: (_cols?: string) => ({
      eq: (_c: string, v: string) => {
        sessionFilter = v;
        return {
          maybeSingle: async () => ({ data: store.get(sessionFilter) ?? null }),
        };
      },
    }),
    update: (patch: Record<string, unknown>) => {
      pendingUpdate = patch;
      return {
        eq: (_c: string, v: string) => {
          sessionFilter = v;
          const chain = {
            neq: (_col: string, _val: string) => {
              requirePending = true;
              return chain;
            },
            select: async (_c?: string) => {
              const row = store.get(sessionFilter);
              if (!row) return { data: [], error: null };
              if (requirePending && row.status === "fulfilled") {
                return { data: [], error: null };
              }
              // Atomic in the real DB; here the whole callback is synchronous
              // between awaits, which is the same guarantee.
              store.set(sessionFilter, { ...row, ...(pendingUpdate as object) } as never);
              return { data: [{ session_id: sessionFilter }], error: null };
            },
            then: undefined as never,
          };
          return chain;
        },
      };
    },
    insert: async (rowData: { session_id: string }) => {
      if (store.has(rowData.session_id)) return { error: { code: "23505", message: "dup" } };
      store.set(rowData.session_id, { status: "fulfilled", kind: "pack" });
      return { error: null };
    },
  };
  return api;
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
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve } },
  })),
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
  store.clear();
  store.set("cs_live_race", { status: "pending", kind: "pack" });
  process.env.STRIPE_SECRET_KEY = "sk_live_test_fixture";
});

it("grants once when the webhook and the return redirect arrive together", async () => {
  const [a, b] = await Promise.all([
    fulfillCheckout("cs_live_race"),
    fulfillCheckout("cs_live_race"),
  ]);

  expect(grants).toHaveLength(1);
  // Both callers still report success — the loser must not surface an error to
  // a buyer whose payment genuinely went through.
  expect(a.ok).toBe(true);
  expect(b.ok).toBe(true);
  expect([a.alreadyFulfilled, b.alreadyFulfilled].filter(Boolean)).toHaveLength(1);
  expect(store.get("cs_live_race")?.status).toBe("fulfilled");
});

it("still grants once when the same session is fulfilled twice in sequence", async () => {
  await fulfillCheckout("cs_live_race");
  await fulfillCheckout("cs_live_race");
  expect(grants).toHaveLength(1);
});
