// Lifecycle coverage for the native subscription engine — the behaviors that
// used to be impossible to get right when a "plan" was three columns on the
// wallet: never opening a second subscription for a plan change, downgrading at
// the boundary instead of mid-period, renewing exactly once per period, and
// dunning a failed charge rather than silently dropping the operator's access.

const grantCredits = jest.fn(async (..._args: unknown[]) => 0);
const chargeSubscription = jest.fn(async (..._args: unknown[]) => ({
  ok: true,
  reference: "ref_1",
}) as { ok: boolean; reference?: string; error?: string; requiresAction?: boolean });

type Row = Record<string, unknown>;

// A minimal in-memory Supabase double: enough query surface for this module
// (select/insert/update/upsert with eq/in/is/lte/order/limit and the single
// terminals), and nothing more.
function makeClient(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const rows = () => (tables[table] ??= []);
    const state: {
      op: "select" | "insert" | "update" | "upsert";
      patch?: Row;
      inserted?: Row[];
      filters: Array<(r: Row) => boolean>;
      conflictKey?: string;
    } = { op: "select", filters: [] };

    const matching = () => rows().filter((r) => state.filters.every((f) => f(r)));

    const resolve = (): { data: Row[] | null; error: null } => {
      if (state.op === "insert") return { data: state.inserted ?? [], error: null };
      if (state.op === "upsert") {
        const key = state.conflictKey ?? "id";
        for (const incoming of state.inserted ?? []) {
          const existing = rows().find((r) => r[key] === incoming[key]);
          if (existing) Object.assign(existing, incoming);
          else rows().push({ ...incoming });
        }
        return { data: state.inserted ?? [], error: null };
      }
      if (state.op === "update") {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, state.patch));
        return { data: hit, error: null };
      }
      return { data: matching(), error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row | Row[]) => {
        state.op = "insert";
        const list = Array.isArray(row) ? row : [row];
        // Stand in for the DB defaults the engine relies on.
        state.inserted = list.map((r) => ({
          id: `row_${rows().length + 1}`,
          created_at: new Date().toISOString(),
          failed_attempts: 0,
          cancel_at_period_end: false,
          canceled_at: null,
          ended_at: null,
          pending_plan: null,
          pending_interval: null,
          last_payment_error: null,
          next_attempt_at: null,
          processor_customer_id: null,
          processor_subscription_id: null,
          ...r,
        }));
        rows().push(...state.inserted);
        return b;
      },
      upsert: (row: Row, opts?: { onConflict?: string }) => {
        state.op = "upsert";
        state.inserted = [row];
        state.conflictKey = opts?.onConflict;
        return b;
      },
      update: (patch: Row) => {
        state.op = "update";
        state.patch = patch;
        return b;
      },
      eq: (col: string, val: unknown) => {
        state.filters.push((r) => r[col] === val);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        state.filters.push((r) => vals.includes(r[col]));
        return b;
      },
      is: (col: string, val: unknown) => {
        state.filters.push((r) => (r[col] ?? null) === val);
        return b;
      },
      lte: (col: string, val: string) => {
        state.filters.push((r) => String(r[col]) <= val);
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: resolve().data?.[0] ?? null, error: null }),
      single: async () => {
        const data = resolve().data?.[0] ?? null;
        return { data, error: data ? null : { message: "no rows" } };
      },
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled),
    };
    return b;
  }
  return { from: (table: string) => builder(table) } as never;
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createServerClient: jest.fn(),
}));
jest.mock("@/lib/credits", () => ({ grantCredits: (...a: unknown[]) => grantCredits(...a) }));
jest.mock("@/lib/gift-earn", () => ({ awardReferralOnSubscription: jest.fn(async () => {}) }));
jest.mock("@/lib/billing-rail", () => ({
  chargeSubscription: (...a: unknown[]) => chargeSubscription(...a),
  activeRail: () => "native",
}));

import {
  startSubscription,
  changePlan,
  cancelSubscription,
  resumeSubscription,
  runSubscriptionRenewals,
} from "@/lib/subscriptions.server";

const ORG = "org_1";

function liveSub(overrides: Row = {}): Row {
  return {
    id: "sub_1",
    organization_id: ORG,
    plan: "pro",
    interval: "monthly",
    status: "active",
    price_usd: 30,
    current_period_start: "2026-06-01T00:00:00.000Z",
    current_period_end: "2026-07-01T00:00:00.000Z",
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    pending_plan: null,
    pending_interval: null,
    failed_attempts: 0,
    last_payment_error: null,
    next_attempt_at: null,
    processor: "native",
    processor_customer_id: null,
    processor_subscription_id: null,
    started_at: "2026-06-01T00:00:00.000Z",
    created_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  grantCredits.mockClear();
  chargeSubscription.mockClear();
  chargeSubscription.mockResolvedValue({ ok: true, reference: "ref_1" });
  // This suite covers the CARD path. Settlement chooses the invoice path when
  // remittance details exist, so they must be absent here — the invoice path has
  // its own coverage in lib/subscription-invoices.test.ts and the end-to-end
  // harness, which need a real database to mean anything.
  delete process.env.FUNDEXECS_REMITTANCE_BANK_NAME;
  delete process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NAME;
  delete process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER;
});

describe("startSubscription", () => {
  it("creates one subscription and grants the plan's credits", async () => {
    const tables: Record<string, Row[]> = { subscriptions: [], subscription_events: [], wallets: [] };
    const res = await startSubscription(
      { orgId: ORG, planKey: "pro", interval: "monthly" },
      makeClient(tables),
    );

    expect(res.ok).toBe(true);
    expect(tables.subscriptions).toHaveLength(1);
    expect(tables.subscriptions[0]).toMatchObject({ plan: "pro", status: "active" });
    expect(grantCredits).toHaveBeenCalledWith(expect.anything(), ORG, 4000, "plan_grant", expect.anything());
    expect(tables.subscription_events[0]).toMatchObject({ kind: "created" });
    // The wallet's entitlement mirror is what the rest of the app reads.
    expect(tables.wallets[0]).toMatchObject({ plan: "pro", plan_interval: "monthly" });
  });

  it("does not charge again when checkout already collected the period", async () => {
    const tables: Record<string, Row[]> = { subscriptions: [], subscription_events: [], wallets: [] };
    await startSubscription(
      { orgId: ORG, planKey: "pro", interval: "monthly", alreadyPaid: true },
      makeClient(tables),
    );
    expect(chargeSubscription).not.toHaveBeenCalled();
  });

  it("grants nothing when the charge fails", async () => {
    chargeSubscription.mockResolvedValue({ ok: false, error: "Card declined." });
    const tables: Record<string, Row[]> = { subscriptions: [], subscription_events: [], wallets: [] };
    const res = await startSubscription(
      { orgId: ORG, planKey: "pro", interval: "monthly" },
      makeClient(tables),
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Card declined.");
    expect(tables.subscriptions).toHaveLength(0);
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("never opens a SECOND subscription for an org that already has one", async () => {
    // This is the double-billing bug: the old flow ran a fresh checkout for a
    // plan switch, leaving two live subscriptions charging the same operator.
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ plan: "starter", price_usd: 5 })],
      subscription_events: [],
      wallets: [],
    };
    const res = await startSubscription(
      { orgId: ORG, planKey: "pro", interval: "monthly" },
      makeClient(tables),
    );

    expect(res.ok).toBe(true);
    expect(tables.subscriptions).toHaveLength(1);
    expect(tables.subscriptions[0]).toMatchObject({ plan: "pro" });
  });
});

describe("changePlan", () => {
  it("applies an upgrade immediately and charges only the prorated difference", async () => {
    // Proration is measured against "now", so pin the clock to the middle of the
    // fixture's period.
    jest.useFakeTimers().setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    try {
      const tables: Record<string, Row[]> = {
        subscriptions: [liveSub({ plan: "starter", price_usd: 5 })],
        subscription_events: [],
        wallets: [],
      };
      const res = await changePlan(
        { orgId: ORG, planKey: "pro", interval: "monthly" },
        makeClient(tables),
      );

      expect(res.ok).toBe(true);
      expect(tables.subscriptions[0]).toMatchObject({ plan: "pro" });
      // Half the period left: half the $25 difference, and half the 3,500 credit
      // difference — not a full month of either.
      expect(chargeSubscription).toHaveBeenCalledWith(expect.objectContaining({ amountUsd: 12.5 }));
      expect(res.credits).toBe(1750);
      expect(tables.subscription_events.at(-1)).toMatchObject({ kind: "upgraded" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("schedules a downgrade for the renewal instead of cutting the period short", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub()],
      subscription_events: [],
      wallets: [],
    };
    const res = await changePlan(
      { orgId: ORG, planKey: "starter", interval: "monthly" },
      makeClient(tables),
    );

    expect(res.ok).toBe(true);
    // Still on Pro until the period ends — credits already granted are not
    // clawed back, and no charge is made.
    expect(tables.subscriptions[0]).toMatchObject({ plan: "pro", pending_plan: "starter" });
    expect(chargeSubscription).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
    expect(tables.subscription_events.at(-1)).toMatchObject({ kind: "downgrade_scheduled" });
  });

  it("clears a scheduled downgrade when the current plan is chosen again", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ pending_plan: "starter", pending_interval: "monthly" })],
      subscription_events: [],
      wallets: [],
    };
    await changePlan({ orgId: ORG, planKey: "pro", interval: "monthly" }, makeClient(tables));
    expect(tables.subscriptions[0]).toMatchObject({ pending_plan: null });
  });
});

describe("cancel and resume", () => {
  it("cancels at period end rather than immediately", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub()],
      subscription_events: [],
      wallets: [],
    };
    const res = await cancelSubscription(ORG, makeClient(tables));

    expect(res.ok).toBe(true);
    expect(tables.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: true });
  });

  it("resumes a cancelled-but-still-running subscription", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ cancel_at_period_end: true, canceled_at: "2026-06-10T00:00:00Z" })],
      subscription_events: [],
      wallets: [],
    };
    await resumeSubscription(ORG, makeClient(tables));
    expect(tables.subscriptions[0]).toMatchObject({ cancel_at_period_end: false, canceled_at: null });
  });

  it("reports a missing subscription instead of throwing", async () => {
    const res = await cancelSubscription(ORG, makeClient({ subscriptions: [] }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No active subscription/);
  });
});

describe("runSubscriptionRenewals", () => {
  const AFTER = new Date("2026-07-01T01:00:00.000Z");

  it("charges, grants and advances a due subscription", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub()],
      subscription_events: [],
      wallets: [{ organization_id: ORG, plan_started_at: "2026-06-01T00:00:00.000Z" }],
    };
    const stats = await runSubscriptionRenewals(makeClient(tables), AFTER);

    expect(stats).toMatchObject({ due: 1, renewed: 1, failed: 0 });
    expect(chargeSubscription).toHaveBeenCalledTimes(1);
    expect(grantCredits).toHaveBeenCalledWith(expect.anything(), ORG, 4000, "plan_grant", expect.anything());
    expect(tables.subscriptions[0]).toMatchObject({
      status: "active",
      current_period_end: "2026-08-01T00:00:00.000Z",
    });
    expect(tables.subscription_events.some((e) => e.kind === "renewed")).toBe(true);
  });

  it("leaves a subscription alone until its period has actually elapsed", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub()],
      subscription_events: [],
      wallets: [],
    };
    const stats = await runSubscriptionRenewals(
      makeClient(tables),
      new Date("2026-06-15T00:00:00.000Z"),
    );
    expect(stats).toMatchObject({ due: 0, renewed: 0 });
    expect(chargeSubscription).not.toHaveBeenCalled();
  });

  it("applies a scheduled downgrade at the boundary", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ pending_plan: "starter", pending_interval: "monthly" })],
      subscription_events: [],
      wallets: [{ organization_id: ORG, plan_started_at: "2026-06-01T00:00:00.000Z" }],
    };
    await runSubscriptionRenewals(makeClient(tables), AFTER);

    expect(tables.subscriptions[0]).toMatchObject({ plan: "starter", pending_plan: null });
    // Charged and granted at the NEW plan's rate, not the old one.
    expect(chargeSubscription).toHaveBeenCalledWith(expect.objectContaining({ amountUsd: 5 }));
    expect(grantCredits).toHaveBeenCalledWith(expect.anything(), ORG, 500, "plan_grant", expect.anything());
  });

  it("closes a cancelled subscription and drops the entitlement", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ cancel_at_period_end: true })],
      subscription_events: [],
      wallets: [{ organization_id: ORG, plan: "pro", plan_interval: "monthly" }],
    };
    const stats = await runSubscriptionRenewals(makeClient(tables), AFTER);

    expect(stats).toMatchObject({ ended: 1, renewed: 0 });
    expect(tables.subscriptions[0]).toMatchObject({ status: "canceled" });
    expect(chargeSubscription).not.toHaveBeenCalled();
    // The plan must actually go away — leaving it set is how a cancelled org
    // used to keep its entitlements forever.
    expect(tables.wallets[0]).toMatchObject({ plan: null, plan_interval: null });
  });

  it("moves a failed charge to past_due with a retry, granting nothing", async () => {
    chargeSubscription.mockResolvedValue({ ok: false, error: "Your card was declined." });
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub()],
      subscription_events: [],
      wallets: [],
    };
    const stats = await runSubscriptionRenewals(makeClient(tables), AFTER);

    expect(stats).toMatchObject({ failed: 1, renewed: 0 });
    expect(grantCredits).not.toHaveBeenCalled();
    expect(tables.subscriptions[0]).toMatchObject({
      status: "past_due",
      failed_attempts: 1,
      last_payment_error: "Your card was declined.",
    });
    expect(tables.subscriptions[0].next_attempt_at).toBeTruthy();
    // Access is NOT cut off on the first decline.
    expect(tables.subscriptions[0].ended_at).toBeNull();
  });

  it("waits for the scheduled retry instead of re-charging every sweep", async () => {
    const tables: Record<string, Row[]> = {
      subscriptions: [
        liveSub({ status: "past_due", failed_attempts: 1, next_attempt_at: "2026-07-05T00:00:00.000Z" }),
      ],
      subscription_events: [],
      wallets: [],
    };
    const stats = await runSubscriptionRenewals(makeClient(tables), AFTER);
    expect(stats).toMatchObject({ due: 0, renewed: 0, failed: 0 });
    expect(chargeSubscription).not.toHaveBeenCalled();
  });

  it("gives the last retry a real attempt, and a card added in time saves the plan", async () => {
    // The point of the dunning window: an operator who fixes their card during
    // it must actually keep the subscription. Closing the row without trying
    // made the window unwinnable and the "update your payment method" advice a
    // lie, so the final attempt has to reach the rail.
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ status: "past_due", failed_attempts: 3 })],
      subscription_events: [],
      wallets: [{ organization_id: ORG, plan: "pro", plan_started_at: "2026-06-01T00:00:00.000Z" }],
    };
    const stats = await runSubscriptionRenewals(makeClient(tables), AFTER);

    expect(chargeSubscription).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ renewed: 1, ended: 0 });
    expect(tables.subscriptions[0]).toMatchObject({ status: "active", failed_attempts: 0 });
    expect(tables.wallets[0]).toMatchObject({ plan: "pro" });
  });

  it("closes the subscription only when that last attempt also fails", async () => {
    chargeSubscription.mockResolvedValue({ ok: false, error: "Your card was declined." });
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ status: "past_due", failed_attempts: 3 })],
      subscription_events: [],
      wallets: [{ organization_id: ORG, plan: "pro" }],
    };
    const stats = await runSubscriptionRenewals(makeClient(tables), AFTER);

    expect(chargeSubscription).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ ended: 1, renewed: 0, failed: 0 });
    expect(tables.subscriptions[0]).toMatchObject({ status: "canceled" });
    expect(tables.wallets[0]).toMatchObject({ plan: null });
    // The failure is on the record before the closure, so the history shows why.
    const kinds = tables.subscription_events.map((e) => e.kind);
    expect(kinds).toContain("payment_failed");
    expect(kinds).toContain("ended");
  });

  it("does not leave a row past_due with a retry date nothing will honour", async () => {
    chargeSubscription.mockResolvedValue({ ok: false, error: "Your card was declined." });
    const tables: Record<string, Row[]> = {
      subscriptions: [liveSub({ status: "past_due", failed_attempts: 3 })],
      subscription_events: [],
      wallets: [{ organization_id: ORG, plan: "pro" }],
    };
    await runSubscriptionRenewals(makeClient(tables), AFTER);
    expect(tables.subscriptions[0].status).not.toBe("past_due");
    expect(tables.subscriptions[0].ended_at).toBeTruthy();
  });
});
