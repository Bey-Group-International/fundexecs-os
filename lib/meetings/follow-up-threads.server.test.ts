import { followUpThreadKey, recordFollowUpThreads, FOLLOW_UP_CHANNEL } from "./follow-up-threads.server";

const ingest = jest.fn();
jest.mock("@/lib/integrations/inbound/ingest", () => ({
  ingestInboundEvent: (...a: unknown[]) => ingest(...a),
}));

function makeDb() {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { client: client as never, upserts };
}

const ok = (extra: Record<string, unknown> = {}) =>
  ({ status: "fulfilled", value: { ok: true, channel: "gmail", detail: "sent", ...extra } }) as const;

const BASE = {
  orgId: "org-1",
  meetingId: "m1",
  hostId: "host-1",
  hostName: "Host Person",
  subject: "Follow-up: Series B sync",
  now: new Date("2026-10-03T12:00:00Z"),
};

beforeEach(() => {
  ingest.mockReset();
  ingest.mockResolvedValue({ ok: true, duplicate: false, threadId: "thr-1", created: true });
});

describe("recordFollowUpThreads", () => {
  it("records each delivered copy as an outbound message on the attendee's meeting thread", async () => {
    const db = makeDb();
    const r = await recordFollowUpThreads(db.client, {
      ...BASE,
      mailbox: { source: "member", email: "host@fund.com" },
      sends: [
        { recipient: { name: "Sarah Chen", email: "Sarah@Acme.com" }, body: "Hi Sarah", result: ok({ gmailMessageId: "gm1", gmailThreadId: "gt1" }) },
        { recipient: { name: "Bo", email: "bo@x.io" }, body: "Hi Bo", result: { status: "rejected", reason: new Error("x") } },
        { recipient: { name: "Ann", email: "ann@x.io" }, body: "Hi Ann", result: { status: "fulfilled", value: { ok: false, channel: "gmail", detail: "bounced" } } },
      ],
    });

    expect(r).toEqual({ recorded: 1, tracked: 1 });
    expect(ingest).toHaveBeenCalledTimes(1);
    const [, orgId, channel, event] = ingest.mock.calls[0] as [unknown, string, string, Record<string, any>];
    expect(orgId).toBe("org-1");
    expect(channel).toBe(FOLLOW_UP_CHANNEL);
    expect(event.eventId).toBe("followup:m1:sarah@acme.com:gm1");
    expect(event.thread).toMatchObject({
      channel: "gmail",
      counterpartyEmail: "sarah@acme.com",
      threadKey: "email:sarah@acme.com:follow-up: series b sync",
      meetingId: "m1",
    });
    expect(event.message).toMatchObject({ direction: "outbound", body: "Hi Sarah", author: "Host Person" });
    expect(db.upserts).toEqual([
      expect.objectContaining({ user_id: "host-1", gmail_thread_id: "gt1", inbox_thread_id: "thr-1", meeting_id: "m1" }),
    ]);
  });

  it("does not track a send from the org mailbox, which the org sweep already reads", async () => {
    const db = makeDb();
    const r = await recordFollowUpThreads(db.client, {
      ...BASE,
      mailbox: { source: "organization", email: null },
      sends: [{ recipient: { name: "S", email: "s@acme.com" }, body: "b", result: ok({ gmailThreadId: "gt1" }) }],
    });
    expect(r).toEqual({ recorded: 1, tracked: 0 });
    expect(db.upserts).toEqual([]);
  });

  it("carries on when recording fails", async () => {
    ingest.mockResolvedValueOnce({ ok: false, error: "db down" });
    const db = makeDb();
    const r = await recordFollowUpThreads(db.client, {
      ...BASE,
      mailbox: { source: "member", email: "h@f.com" },
      sends: [
        { recipient: { name: "A", email: "a@x.io" }, body: "a", result: ok({ gmailThreadId: "g1" }) },
        { recipient: { name: "B", email: "b@x.io" }, body: "b", result: ok({ gmailThreadId: "g2" }) },
      ],
    });
    expect(r).toEqual({ recorded: 1, tracked: 1 });
  });
});

describe("followUpThreadKey", () => {
  it("keys the way inbound replies are keyed", () => {
    expect(followUpThreadKey("Ana@Acme.com", "Re: Follow-up: X")).toBe("email:ana@acme.com:follow-up: x");
  });
});
