// Concurrency/idempotency coverage for gift redemption — the fix moves the
// credit grant BEHIND a compare-and-set on `status = 'pending'`, so a token
// redeemed twice (double-click, or forwarded to two orgs) can only ever grant
// credits once.

const grantCredits = jest.fn(async (..._args: unknown[]) => {});

// A tiny stateful Supabase double: one gift row, and a conditional update that
// only "claims" the row while it is still pending — mirroring the real
// `.update(...).eq('id').eq('status','pending').select('id')` behavior.
type GiftRow = {
  id: string;
  redeem_token: string;
  status: string;
  credits: number;
  sender_organization_id: string;
  redeemed_by_organization_id: string | null;
  redeemed_at: string | null;
};

function makeServiceClient(gift: GiftRow) {
  const builder = () => {
    const state: {
      op: "select" | "update";
      patch?: Partial<GiftRow>;
      filters: Record<string, unknown>;
    } = { op: "select", filters: {} };

    const resolveUpdate = () => {
      // Apply only if every filter matches (id + status='pending').
      const matches =
        state.filters["id"] === gift.id &&
        (state.filters["status"] === undefined || gift.status === state.filters["status"]);
      if (!matches) return { data: [], error: null };
      Object.assign(gift, state.patch);
      return { data: [{ id: gift.id }], error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      update: (patch: Partial<GiftRow>) => {
        state.op = "update";
        state.patch = patch;
        return b;
      },
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        // Terminal for the update path: `.eq('status','pending')` is the last
        // call before the trailing `.select('id')`, which returns `b` (thenable).
        return b;
      },
      maybeSingle: async () => ({ data: gift.redeem_token === state.filters["redeem_token"] ? gift : null, error: null }),
      // Make the builder awaitable so the update chain resolves to claimed rows.
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(state.op === "update" ? resolveUpdate() : { data: gift, error: null }).then(onFulfilled),
    };
    return b;
  };
  return { from: () => builder() };
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createServerClient: jest.fn(),
}));
jest.mock("@/lib/credits", () => ({ grantCredits: (...a: unknown[]) => grantCredits(...a) }));

import { redeemGift } from "@/lib/gift-earn";
import { createServiceClient } from "@/lib/supabase/server";

const baseGift = (): GiftRow => ({
  id: "gift-1",
  redeem_token: "TESTTOKEN",
  status: "pending",
  credits: 500,
  sender_organization_id: "org-sender",
  redeemed_by_organization_id: null,
  redeemed_at: null,
});

beforeEach(() => grantCredits.mockClear());

describe("redeemGift idempotency", () => {
  it("grants credits exactly once and marks the gift redeemed", async () => {
    const gift = baseGift();
    (createServiceClient as jest.Mock).mockReturnValue(makeServiceClient(gift));

    const res = await redeemGift("TESTTOKEN", "org-redeemer");

    expect(res).toEqual({ ok: true, credits: 500 });
    expect(grantCredits).toHaveBeenCalledTimes(1);
    expect(gift.status).toBe("redeemed");
    expect(gift.redeemed_by_organization_id).toBe("org-redeemer");
  });

  it("does not double-credit when the same token is redeemed twice", async () => {
    const gift = baseGift();
    (createServiceClient as jest.Mock).mockReturnValue(makeServiceClient(gift));

    const first = await redeemGift("TESTTOKEN", "org-redeemer");
    // Second call reads the now-'redeemed' gift and is rejected before any grant.
    const second = await redeemGift("TESTTOKEN", "org-other");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(grantCredits).toHaveBeenCalledTimes(1);
  });

  it("rejects redeeming your own gift without granting", async () => {
    const gift = baseGift();
    (createServiceClient as jest.Mock).mockReturnValue(makeServiceClient(gift));

    const res = await redeemGift("TESTTOKEN", "org-sender");

    expect(res.ok).toBe(false);
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
