/**
 * Drafting a meeting's follow-up into the inbox.
 *
 * The property this file exists for is the one in the route's name: NOTHING IS
 * SENT. Asserted on what the route touches — no inbox_messages row, no mailer —
 * rather than on a comment saying so, because the sibling route two directories up
 * does send and the two take the same body from the same button.
 */
const requireOrgContext = jest.fn();
const from = jest.fn();
const loadPresentPeople = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
}));
jest.mock("@/lib/meetings/recipients.server", () => ({
  loadPresentPeople: (...a: unknown[]) => loadPresentPeople(...a),
}));

import { POST } from "./route";

const HOST = { ok: true, ctx: { userId: "host-1", orgId: "org-1", email: "host@fund.test" } };

const MEETING = {
  id: "m1",
  title: "Series B sync",
  host_id: "host-1",
  organization_id: "org-1",
  attendees: [
    { name: "Sarah Chen", email: "Sarah@Fund.test" },
    { name: "Host", email: "host@fund.test" },
    { name: "Priya" },
  ],
};

const REPORT = { analysis: { follow_up_draft: "Hi all,\n\nGood meeting.\n\n— Host" } };

const THREAD = {
  id: "thread-sarah",
  channel: "gmail",
  status: "open",
  counterparty_email: "Sarah@Fund.test",
  last_message_at: "2026-09-01T00:00:00.000Z",
};

/** Every table the route touched, and what it wrote. */
let touched: string[] = [];
let inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
let upserted: Array<Record<string, unknown>> = [];
/** The filters put on the candidate-thread read. */
let threadQuery: { eq: Array<[string, unknown]>; in: Array<[string, unknown]> };

function wire(
  opts: {
    meeting?: unknown;
    report?: unknown;
    threads?: unknown[];
    threadError?: { message: string } | null;
    insertFails?: boolean;
    upsertFails?: boolean;
  } = {},
) {
  from.mockImplementation((table: string) => {
    touched.push(table);
    const b: Record<string, unknown> = {
      select: () => b,
      is: () => b,
      order: () => b,
      eq: (col: string, val: unknown) => {
        if (table === "inbox_threads") threadQuery.eq.push([col, val]);
        return b;
      },
      in: (col: string, val: unknown) => {
        if (table === "inbox_threads") threadQuery.in.push([col, val]);
        return b;
      },
      // Awaited directly by the candidate-thread read, and chained into
      // `.maybeSingle()` by the report read — so it has to be both a promise and
      // a builder.
      limit: () =>
        Object.assign(
          Promise.resolve(
            opts.threadError
              ? { data: null, error: opts.threadError }
              : { data: "threads" in opts ? opts.threads : [THREAD], error: null },
          ),
          b,
        ),
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        return {
          select: () => ({
            maybeSingle: async () =>
              opts.insertFails
                ? { data: null, error: { message: "denied" } }
                : { data: { id: "thread-new" }, error: null },
          }),
        };
      },
      upsert: async (row: Record<string, unknown>) => {
        upserted.push(row);
        return { error: opts.upsertFails ? { message: "denied" } : null };
      },
      maybeSingle: async () => ({
        data: table === "live_meetings" ? ("meeting" in opts ? opts.meeting : MEETING) : "report" in opts ? opts.report : REPORT,
        error: null,
      }),
    };
    return b;
  });
}

const req = (body?: unknown) =>
  new Request("http://localhost/api/meetings/m1/follow-up/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }) as never;

const params = Promise.resolve({ id: "m1" });

beforeEach(() => {
  jest.clearAllMocks();
  touched = [];
  inserted = [];
  upserted = [];
  threadQuery = { eq: [], in: [] };
  requireOrgContext.mockResolvedValue(HOST);
  loadPresentPeople.mockResolvedValue([]);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("nothing is sent", () => {
  it("writes no message onto the thread", async () => {
    wire();
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    // The one table that would put this in front of the counterparty.
    expect(touched).not.toContain("inbox_messages");
    expect(inserted.map((i) => i.table)).not.toContain("inbox_messages");
  });

  it("says so in the response, not only in the copy", async () => {
    wire();
    const body = await (await POST(req(), { params })).json();
    expect(body.sent).toBe(0);
    expect(body.message).toMatch(/Nothing has been sent/);
  });

  /**
   * `followup_status` stays as it was. A drafted follow-up still needs a person,
   * and closing the "Follow-Up Needed" badge here would hide exactly the meetings
   * that are one press from being done.
   */
  it("does not mark the meeting followed up", async () => {
    wire();
    await POST(req(), { params });
    expect(inserted.some((i) => i.table === "live_meetings")).toBe(false);
  });
});

describe("permission", () => {
  it("refuses anyone who is not the host", async () => {
    wire({ meeting: { ...MEETING, host_id: "someone-else" } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(upserted).toEqual([]);
  });

  it("404s a meeting that is not there", async () => {
    wire({ meeting: null });
    expect((await POST(req(), { params })).status).toBe(404);
  });

  /**
   * A meeting held in another organisation must not be drafted into this one's
   * inbox. Without this the caller's own org would stand in for the meeting's and
   * file one organisation's follow-up in another's correspondence.
   */
  it("refuses a meeting that is not this organisation's", async () => {
    wire({ meeting: { ...MEETING, organization_id: "org-2" } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(upserted).toEqual([]);
  });

  it("refuses a meeting with no organisation at all", async () => {
    wire({ meeting: { ...MEETING, organization_id: null } });
    expect((await POST(req(), { params })).status).toBe(409);
  });
});

describe("what it asks the inbox for", () => {
  it("looks up candidate threads by lowercased address, in this org, on email only", async () => {
    wire();
    await POST(req(), { params });
    // The host is not in it: the follow-up is not drafted to its author.
    expect(threadQuery.in).toEqual([["counterparty_email_lower", ["sarah@fund.test"]]]);
    expect(threadQuery.eq).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-1"],
        ["channel", "gmail"],
      ]),
    );
  });

  it("refuses when the inbox cannot be read rather than drafting half of it", async () => {
    wire({ threadError: { message: "boom" } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(502);
    expect(upserted).toEqual([]);
  });
});

describe("what it writes", () => {
  it("upserts the draft onto the existing thread, keyed on the thread", async () => {
    wire();
    await POST(req(), { params });
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({
      thread_id: "thread-sarah",
      organization_id: "org-1",
      body: "Hi all,\n\nGood meeting.\n\n— Host",
      source: "meeting_follow_up",
      source_meeting_id: "m1",
      created_by: "host-1",
    });
    expect(inserted).toEqual([]);
  });

  it("prefers the host's edit over the stored draft", async () => {
    wire();
    await POST(req({ body: "Rewritten by hand." }), { params });
    expect(upserted[0]).toMatchObject({ body: "Rewritten by hand." });
  });

  /**
   * A created thread is marked read and left with no recency, because neither is
   * true: nothing arrived and nothing was said. Writing a `last_message_at` here
   * would put a fabricated time on a thread with no messages, and every reader of
   * that column downstream would believe it.
   */
  it("creates a thread when the attendee has none, without inventing activity", async () => {
    wire({ threads: [] });
    const res = await POST(req(), { params });
    expect(await res.json()).toMatchObject({ drafted: 1, created: 1 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].row).toMatchObject({
      organization_id: "org-1",
      channel: "gmail",
      category: "messaging",
      subject: "Follow-up: Series B sync",
      counterparty_name: "Sarah Chen",
      counterparty_email: "sarah@fund.test",
      status: "open",
      unread: false,
    });
    expect(inserted[0].row).not.toHaveProperty("last_message_at");
    expect(upserted[0]).toMatchObject({ thread_id: "thread-new" });
  });

  it("reports a thread it could not create as a failure, not as a draft", async () => {
    wire({ threads: [], insertFails: true });
    const body = await (await POST(req(), { params })).json();
    expect(body).toMatchObject({ drafted: 0, created: 0, failed: 1 });
    expect(upserted).toEqual([]);
  });

  /**
   * The thread was created and the draft was not. Counting it as created would
   * report "1 of them a new thread" for a draft that does not exist — the count of
   * created threads describes drafts that landed, not inserts that happened.
   */
  it("does not count a created thread whose draft then failed", async () => {
    wire({ threads: [], upsertFails: true });
    const body = await (await POST(req(), { params })).json();
    expect(body).toMatchObject({ drafted: 0, created: 0, failed: 1 });
  });
});

describe("when there is nothing to draft", () => {
  it("refuses a meeting whose report has no follow-up", async () => {
    wire({ report: { analysis: {} } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(upserted).toEqual([]);
  });

  // Said plainly, and carrying the names, because the host is the only person who
  // can reach somebody with no address here.
  it("refuses a meeting where nobody has an address, and names them", async () => {
    wire({ meeting: { ...MEETING, attendees: [{ name: "Priya" }] } });
    loadPresentPeople.mockResolvedValue([{ name: "Priya", email: null }]);
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ unreachable: ["Priya"] });
  });
});

describe("who it drafts for", () => {
  // The invite list AND the room: somebody who walked in uninvited was in the
  // conversation the follow-up commits them to. Same union as the send path.
  it("includes somebody who was in the room but not invited", async () => {
    wire({ threads: [] });
    loadPresentPeople.mockResolvedValue([{ name: "Ben Okoro", email: "ben@fund.test" }]);
    await POST(req(), { params });
    expect(threadQuery.in[0][1]).toEqual(["sarah@fund.test", "ben@fund.test"]);
    expect(upserted).toHaveLength(2);
  });
});
