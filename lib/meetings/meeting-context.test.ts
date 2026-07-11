// The server-side meeting-context loaders gather an org-scoped meeting + its
// linked deal/fund/lead (and, for follow-up, the latest report) and compose the
// institutional context string that /api/chat injects into the model call. The
// composed string is server-only; these tests assert the right context is built
// and that a cross-org meeting yields null (no context, no leak).

import { loadMeetingPrepContext, loadMeetingFollowupContext } from "./meeting-context";

type Tables = {
  live_meetings?: unknown;
  deals?: unknown;
  funds?: unknown;
  principals?: unknown;
  live_meeting_reports?: unknown;
};

// A chainable query-builder stub: every filter/order returns itself and the
// terminal maybeSingle() resolves the wired row for the table.
function rowBuilder(data: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: async () => ({ data, error: null }),
  };
  return b;
}

function fakeClient(tables: Tables) {
  return {
    from: (table: string) => rowBuilder((tables as Record<string, unknown>)[table] ?? null),
  } as unknown as Parameters<typeof loadMeetingPrepContext>[0];
}

describe("loadMeetingPrepContext", () => {
  it("composes prep context from meeting + deal + lead + fund", async () => {
    const ctx = await loadMeetingPrepContext(
      fakeClient({
        live_meetings: { title: "LP Update", objective: "Secure re-up", deal_id: "d1", related_fund_id: null, attendees: [{ name: "Jane", type: "external" }] },
        deals: { name: "Atlas Logistics", stage: "diligence", target_amount: 25_000_000, fund_id: "f1", lead_principal: "p1" },
        funds: { name: "Fund III", committed_capital: 250_000_000, currency: "USD" },
        principals: { full_name: "Maria Chen", title: "managing_director", email: "maria@fundexecs.com" },
      }),
      "org1",
      "m1",
    );
    expect(ctx).toContain("LP Update");
    expect(ctx).toContain("Secure re-up");
    expect(ctx).toContain("Atlas Logistics");
    expect(ctx).toContain("Fund III");
    expect(ctx).toContain("Jane");
    expect(ctx).toContain("DEAL LEAD");
    expect(ctx).toContain("Maria Chen");
    expect(ctx).toContain("Managing Director");
  });

  it("omits the deal lead when the deal has no lead principal", async () => {
    const ctx = await loadMeetingPrepContext(
      fakeClient({
        live_meetings: { title: "Deal review", deal_id: "d1", related_fund_id: null, attendees: null },
        deals: { name: "Atlas", fund_id: "f1", lead_principal: null },
        funds: { name: "Vehicle One" },
      }),
      "org1",
      "m1",
    );
    expect(ctx).toContain("Vehicle One");
    expect(ctx).not.toContain("DEAL LEAD");
  });

  it("returns null when the meeting isn't in the caller's org", async () => {
    const ctx = await loadMeetingPrepContext(fakeClient({ live_meetings: null }), "org1", "m1");
    expect(ctx).toBeNull();
  });
});

describe("loadMeetingFollowupContext", () => {
  it("composes follow-up context and folds in saved report notes", async () => {
    const ctx = await loadMeetingFollowupContext(
      fakeClient({
        live_meetings: { title: "LP Update", deal_id: "d1", related_fund_id: null, attendees: null },
        deals: { name: "Atlas Logistics", fund_id: "f1" },
        funds: { name: "Fund III" },
        live_meeting_reports: {
          summary: "Re-up verbally agreed",
          key_points: ["Strong DPI", "Wants co-invest"],
          action_items: ["Send updated LPA"],
        },
      }),
      "org1",
      "m1",
    );
    expect(ctx).toContain("Atlas Logistics");
    expect(ctx).toContain("Fund III");
    expect(ctx).toContain("Re-up verbally agreed");
    expect(ctx).toContain("Send updated LPA");
  });

  it("returns null when the meeting isn't in the caller's org", async () => {
    const ctx = await loadMeetingFollowupContext(fakeClient({ live_meetings: null }), "org1", "m1");
    expect(ctx).toBeNull();
  });
});
