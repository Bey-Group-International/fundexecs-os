import {
  addMonths,
  advancePeriod,
  changeDirection,
  daysRemaining,
  formatBillingDate,
  isDue,
  isExhausted,
  nextAttemptAt,
  nextBillingSummary,
  periodEnd,
  prorateUpgrade,
  renewalCredits,
  renewalPrice,
  renewalTarget,
  subscriptionHealth,
  PAST_DUE_MAX_ATTEMPTS,
  type Subscription,
} from "@/lib/subscriptions";

// A live monthly Pro subscription whose period runs the whole of June 2026.
function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    organization_id: "org_1",
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
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("period math", () => {
  it("adds whole months", () => {
    expect(addMonths(new Date("2026-06-15T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-07-15",
    );
  });

  it("clamps the day rather than spilling into the next month", () => {
    // Jan 31 + 1 month must be Feb 28 — the naive setMonth gives Mar 3.
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
    // …and Feb 29 in a leap year.
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2028-02-29",
    );
  });

  it("ends a monthly period a month out and an annual one a year out", () => {
    const start = new Date("2026-06-01T00:00:00Z");
    expect(periodEnd(start, "monthly").toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(periodEnd(start, "annual").toISOString().slice(0, 10)).toBe("2027-06-01");
  });

  it("is due only once the period has elapsed", () => {
    expect(isDue(sub(), new Date("2026-06-30T23:00:00Z"))).toBe(false);
    expect(isDue(sub(), new Date("2026-07-01T00:00:00Z"))).toBe(true);
  });

  it("reports whole days of remaining access", () => {
    expect(daysRemaining(sub(), new Date("2026-06-29T00:00:00Z"))).toBe(2);
    expect(daysRemaining(sub(), new Date("2026-07-05T00:00:00Z"))).toBe(0);
  });
});

describe("advancePeriod", () => {
  it("advances one period when the sweep runs on time", () => {
    const { start, end } = advancePeriod(
      new Date("2026-06-01T00:00:00Z"),
      "monthly",
      new Date("2026-07-01T01:00:00Z"),
    );
    expect(start.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(end.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("catches up in ONE step after a long outage, rather than billing per missed cycle", () => {
    // Sweep down for three months: the operator was not served those periods and
    // must not be charged three times to catch up.
    const { start, end } = advancePeriod(
      new Date("2026-06-01T00:00:00Z"),
      "monthly",
      new Date("2026-09-15T00:00:00Z"),
    );
    expect(start.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(end.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("gets the billing day back after a short month, instead of drifting", () => {
    // Anchored on Jan 31: February borrows the 28th, March must get the 31st
    // back. Stepping from the previous period would strand the subscriber on
    // the 28th forever.
    const feb = advancePeriod(new Date("2026-01-31T00:00:00Z"), "monthly", new Date("2026-03-01T00:00:00Z"));
    expect(feb.start.toISOString().slice(0, 10)).toBe("2026-02-28");
    const mar = advancePeriod(new Date("2026-01-31T00:00:00Z"), "monthly", new Date("2026-04-01T00:00:00Z"));
    expect(mar.start.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("steps a year at a time for an annual subscription", () => {
    const { start, end } = advancePeriod(
      new Date("2026-06-01T00:00:00Z"),
      "annual",
      new Date("2027-08-01T00:00:00Z"),
    );
    expect(start.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(end.toISOString().slice(0, 10)).toBe("2028-06-01");
  });
});

describe("changeDirection", () => {
  it("ranks tiers by price", () => {
    expect(changeDirection({ plan: "starter", interval: "monthly" }, { plan: "pro", interval: "monthly" })).toBe("upgrade");
    expect(changeDirection({ plan: "scale", interval: "monthly" }, { plan: "pro", interval: "monthly" })).toBe("downgrade");
  });

  it("treats the same tier and interval as no change", () => {
    expect(changeDirection({ plan: "pro", interval: "annual" }, { plan: "pro", interval: "annual" })).toBe("same");
  });

  it("treats a switch to annual at the same tier as an upgrade", () => {
    expect(changeDirection({ plan: "pro", interval: "monthly" }, { plan: "pro", interval: "annual" })).toBe("upgrade");
    expect(changeDirection({ plan: "pro", interval: "annual" }, { plan: "pro", interval: "monthly" })).toBe("downgrade");
  });
});

describe("prorateUpgrade", () => {
  it("charges only the price difference for the unused remainder", () => {
    // Half of June gone: Starter ($5) → Pro ($30) costs half the $25 difference.
    const p = prorateUpgrade(sub({ plan: "starter", price_usd: 5 }), { plan: "pro", interval: "monthly" }, new Date("2026-06-16T00:00:00Z"));
    expect(p.unusedFraction).toBeCloseTo(0.5, 2);
    expect(p.amountUsd).toBeCloseTo(12.5, 2);
    // …and grants half the credit difference (4,000 − 500 = 3,500).
    expect(p.credits).toBe(1750);
  });

  it("charges the full difference when the upgrade happens at the start of a period", () => {
    const p = prorateUpgrade(sub({ plan: "starter" }), { plan: "pro", interval: "monthly" }, new Date("2026-06-01T00:00:00Z"));
    expect(p.amountUsd).toBeCloseTo(25, 2);
    expect(p.credits).toBe(3500);
  });

  it("charges nothing once the period has run out", () => {
    const p = prorateUpgrade(sub({ plan: "starter" }), { plan: "pro", interval: "monthly" }, new Date("2026-07-02T00:00:00Z"));
    expect(p.amountUsd).toBe(0);
    expect(p.credits).toBe(0);
  });

  it("never produces a negative charge or a negative grant", () => {
    // A "change" that prices lower settles at zero rather than as a refund.
    const p = prorateUpgrade(sub({ plan: "scale" }), { plan: "starter", interval: "monthly" }, new Date("2026-06-15T00:00:00Z"));
    expect(p.amountUsd).toBe(0);
    expect(p.credits).toBe(0);
  });
});

describe("renewal target", () => {
  it("renews into the current plan when nothing is scheduled", () => {
    expect(renewalTarget(sub())).toEqual({ plan: "pro", interval: "monthly" });
    expect(renewalPrice(sub())).toBe(30);
    expect(renewalCredits(sub())).toBe(4000);
  });

  it("renews into a scheduled downgrade", () => {
    const s = sub({ pending_plan: "starter", pending_interval: "monthly" });
    expect(renewalTarget(s)).toEqual({ plan: "starter", interval: "monthly" });
    expect(renewalPrice(s)).toBe(5);
    expect(renewalCredits(s)).toBe(500);
  });

  it("prices an annual renewal as the annual amount and a full year of credits", () => {
    const s = sub({ interval: "annual" });
    expect(renewalPrice(s)).toBe(300);
    expect(renewalCredits(s)).toBe(4000 * 12);
  });
});

describe("dunning", () => {
  it("retries on a widening schedule then gives up", () => {
    const from = new Date("2026-07-01T00:00:00Z");
    expect(nextAttemptAt(1, from)?.toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(nextAttemptAt(2, from)?.toISOString().slice(0, 10)).toBe("2026-07-04");
    expect(nextAttemptAt(3, from)?.toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(nextAttemptAt(PAST_DUE_MAX_ATTEMPTS + 1, from)).toBeNull();
  });

  it("is exhausted only after the last retry", () => {
    expect(isExhausted(sub({ failed_attempts: PAST_DUE_MAX_ATTEMPTS - 1 }))).toBe(false);
    expect(isExhausted(sub({ failed_attempts: PAST_DUE_MAX_ATTEMPTS }))).toBe(true);
  });
});

describe("display", () => {
  it("derives health from status and pending cancellation", () => {
    expect(subscriptionHealth(null)).toBe("none");
    expect(subscriptionHealth(sub())).toBe("active");
    expect(subscriptionHealth(sub({ cancel_at_period_end: true }))).toBe("ending");
    expect(subscriptionHealth(sub({ status: "past_due" }))).toBe("past_due");
    expect(subscriptionHealth(sub({ status: "canceled" }))).toBe("none");
  });

  it("says what happens next", () => {
    expect(nextBillingSummary(sub(), new Date("2026-06-15T00:00:00Z"))).toMatch(/^Renews on/);
    expect(nextBillingSummary(sub({ cancel_at_period_end: true }), new Date("2026-06-29T00:00:00Z"))).toMatch(/Cancels on/);
    expect(nextBillingSummary(sub({ status: "past_due", failed_attempts: 1, next_attempt_at: "2026-07-03T00:00:00Z" }))).toMatch(/retry/);
    expect(nextBillingSummary(sub({ pending_plan: "starter" }))).toMatch(/Switches to Starter/);
    expect(nextBillingSummary(null)).toBe("No active subscription.");
  });

  it("does not promise a retry that is really a cancellation", () => {
    // The sweep closes an exhausted subscription instead of charging it again,
    // so the scheduled date is the day the plan ENDS. Telling the operator
    // "we'll retry on the 6th" when the 6th is when they lose the plan is the
    // one thing this line must never do.
    const spent = sub({
      status: "past_due",
      failed_attempts: PAST_DUE_MAX_ATTEMPTS,
      next_attempt_at: "2026-07-06T00:00:00Z",
    });
    const line = nextBillingSummary(spent);
    expect(line).not.toMatch(/retry/i);
    expect(line).toMatch(/ends on/i);
    expect(line).toMatch(/July 6, 2026/);
  });

  it("still promises a retry while retries remain", () => {
    const line = nextBillingSummary(
      sub({ status: "past_due", failed_attempts: PAST_DUE_MAX_ATTEMPTS - 1, next_attempt_at: "2026-07-04T00:00:00Z" }),
    );
    expect(line).toMatch(/We'll retry on/);
  });

  it("degrades honestly when an exhausted row has no date", () => {
    expect(
      nextBillingSummary(sub({ status: "past_due", failed_attempts: PAST_DUE_MAX_ATTEMPTS, next_attempt_at: null })),
    ).toMatch(/ending/i);
  });

  it("formats a billing date, and tolerates a missing one", () => {
    expect(formatBillingDate("2026-07-01T00:00:00Z")).toMatch(/2026/);
    expect(formatBillingDate(null)).toBe("—");
    expect(formatBillingDate("not-a-date")).toBe("—");
  });
});
