/**
 * The read behind the history panel, and the three things about it that are not
 * visible from the pure rule.
 *
 *   - WHICH column it filters on. The addresses are lowercased; the stored column
 *     is not. Filtering the raw column would return an empty history for every
 *     provider that capitalises an address, which looks exactly like "we have
 *     never spoken to this person".
 *   - WHICH organisation's inbox it reads. RLS answers "may you see this row",
 *     not "is this the right org" — a reader who belongs to two would otherwise
 *     be shown whichever one the row happened to be in.
 *   - that it never throws. The report is the page; a failed sidebar shows no
 *     sidebar.
 */
import { loadAttendeeInboxHistory, THREAD_READ_LIMIT } from "./report-inbox.server";
import type { PresentPerson } from "./recipients";

const loadPresentPeople = jest.fn<Promise<PresentPerson[]>, unknown[]>();
jest.mock("./recipients.server", () => ({
  loadPresentPeople: (...args: unknown[]) => loadPresentPeople(...args),
}));

interface Recorded {
  table: string;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  limit: number | null;
}

/** Records the query as built, and answers with the rows given. */
function client(opts: { rows?: unknown[]; error?: string; throws?: boolean } = {}) {
  const calls: Recorded[] = [];
  const api = {
    from(table: string) {
      if (opts.throws) throw new Error("boom");
      const rec: Recorded = { table, eq: [], in: [], order: [], limit: null };
      calls.push(rec);
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          rec.eq.push([col, val]);
          return chain;
        },
        in: (col: string, val: unknown) => {
          rec.in.push([col, val]);
          return chain;
        },
        order: (col: string, val: unknown) => {
          rec.order.push([col, val]);
          return chain;
        },
        limit: (n: number) => {
          rec.limit = n;
          return Promise.resolve(
            opts.error ? { data: null, error: { message: opts.error } } : { data: opts.rows ?? [], error: null },
          );
        },
      };
      return chain;
    },
  };
  return { api: api as never, calls };
}

const THREAD = {
  id: "t1",
  channel: "gmail",
  subject: "Pacing",
  counterparty_email: "Ana@Acme.com",
  status: "open",
  unread: false,
  ai_summary: null,
  preview: null,
  last_message_at: "2026-09-20T10:00:00.000Z",
};

beforeEach(() => {
  loadPresentPeople.mockReset();
  loadPresentPeople.mockResolvedValue([]);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what it asks the database for", () => {
  it("filters the generated lowercase column with lowercased addresses", async () => {
    const { api, calls } = client({ rows: [THREAD] });
    await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [{ name: "Ana", email: "Ana@Acme.com" }],
    });

    const read = calls.find((c) => c.table === "inbox_threads")!;
    expect(read.in).toEqual([["counterparty_email_lower", ["ana@acme.com"]]]);
  });

  it("scopes the read to the meeting's organisation", async () => {
    const { api, calls } = client({ rows: [THREAD] });
    await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [{ name: "Ana", email: "ana@acme.com" }],
    });
    expect(calls.find((c) => c.table === "inbox_threads")!.eq).toEqual([
      ["organization_id", "org-1"],
    ]);
  });

  it("bounds the read", async () => {
    const { api, calls } = client({ rows: [THREAD] });
    await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [{ name: "Ana", email: "ana@acme.com" }],
    });
    expect(calls.find((c) => c.table === "inbox_threads")!.limit).toBe(THREAD_READ_LIMIT);
  });

  /**
   * A meeting with no organisation has no inbox to read. Falling through to an
   * unscoped query would hand the choice of organisation to RLS, which does not
   * answer that question.
   */
  it("reads nothing at all when the meeting has no organisation", async () => {
    const { api, calls } = client({ rows: [THREAD] });
    const history = await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: null,
      invited: [{ name: "Ana", email: "ana@acme.com" }],
    });
    expect(calls).toEqual([]);
    expect(history).toEqual({ attendees: [], untouched: [] });
  });

  it("reads nothing when no attendee has a usable address", async () => {
    const { api, calls } = client({ rows: [THREAD] });
    const history = await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [{ name: "Guest", email: "not-an-address" }],
    });
    expect(calls.some((c) => c.table === "inbox_threads")).toBe(false);
    expect(history).toEqual({ attendees: [], untouched: [] });
  });
});

describe("who ends up in it", () => {
  // The same union both email paths use: somebody who walked into the room
  // uninvited was in the conversation this report is about.
  it("includes the people who were in the room, not just the invite list", async () => {
    loadPresentPeople.mockResolvedValue([{ name: "Ben Okoro", email: "ben@acme.com" }]);
    const { api, calls } = client({ rows: [] });
    await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [],
    });
    expect(calls.find((c) => c.table === "inbox_threads")!.in[0][1]).toEqual(["ben@acme.com"]);
  });

  // A panel telling the reader where they are with themselves is noise on every
  // report, and it is the same exclusion the follow-up email makes.
  it("leaves the reader out", async () => {
    const { api, calls } = client({ rows: [] });
    await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [
        { name: "Ana", email: "ana@acme.com" },
        { name: "Me", email: "me@fundexecs.com" },
      ],
      viewerEmail: "me@fundexecs.com",
    });
    expect(calls.find((c) => c.table === "inbox_threads")!.in[0][1]).toEqual(["ana@acme.com"]);
  });
});

describe("when the read goes wrong", () => {
  it("returns an empty history on a query error", async () => {
    const { api } = client({ error: "permission denied" });
    await expect(
      loadAttendeeInboxHistory(api, {
        meetingId: "m1",
        organizationId: "org-1",
        invited: [{ name: "Ana", email: "ana@acme.com" }],
      }),
    ).resolves.toEqual({ attendees: [], untouched: [] });
  });

  it("returns an empty history rather than throwing", async () => {
    const { api } = client({ throws: true });
    await expect(
      loadAttendeeInboxHistory(api, {
        meetingId: "m1",
        organizationId: "org-1",
        invited: [{ name: "Ana", email: "ana@acme.com" }],
      }),
    ).resolves.toEqual({ attendees: [], untouched: [] });
  });

  // Past the ceiling every per-attendee total is an undercount, and a count that
  // is quietly wrong on a page people read as a record is worse than one missing.
  it("says so when the read hits its ceiling", async () => {
    const rows = Array.from({ length: THREAD_READ_LIMIT }, (_, i) => ({ ...THREAD, id: `t${i}` }));
    const { api } = client({ rows });
    await loadAttendeeInboxHistory(api, {
      meetingId: "m1",
      organizationId: "org-1",
      invited: [{ name: "Ana", email: "ana@acme.com" }],
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[report-inbox] thread read hit the ceiling",
      expect.objectContaining({ limit: THREAD_READ_LIMIT }),
    );
  });
});
