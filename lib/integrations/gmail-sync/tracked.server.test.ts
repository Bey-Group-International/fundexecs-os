// Replies read back from a host's own mailbox: only the tracked thread, only
// new messages, onto the follow-up's meeting — and a grant without the read
// scope is told to reconnect, not retried every hour.
import {
  grantCanRead,
  isTrackedThreadDue,
  MISSING_SCOPE_ERROR,
  syncTrackedThreads,
  TRACKED_CHANNEL,
} from "./tracked.server";

const ingest = jest.fn();
jest.mock("@/lib/integrations/inbound/ingest", () => ({
  ingestInboundEvent: (...a: unknown[]) => ingest(...a),
}));
jest.mock("@/lib/calendar/google.server", () => ({ accessTokenFor: jest.fn() }));

const READ = "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";
const NOW = new Date("2026-10-03T12:00:00Z");

const ROW = {
  id: "tr1",
  organization_id: "org-1",
  user_id: "host-1",
  gmail_thread_id: "gth1",
  inbox_thread_id: "thr-1",
  meeting_id: "m1",
  mailbox_email: "host@fund.com",
  last_checked_at: null,
  last_error: null,
  expires_at: "2026-11-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
};

function b64(t: string) {
  return Buffer.from(t).toString("base64url");
}
function msg(id: string, from: string, extraHeaders: Array<{ name: string; value: string }> = []) {
  return {
    id,
    labelIds: ["INBOX"],
    internalDate: "1790000000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: "host@fund.com" },
        { name: "Subject", value: "Re: Follow-up: Series B sync" },
        ...extraHeaders,
      ],
      body: { data: b64(`text ${id}`) },
    },
  };
}

function makeDb(opts: { rows?: unknown[]; scope?: string | null; seen?: string[] } = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      lte: () => Promise.resolve({ error: null }),
      order: () => chain,
      limit: () => Promise.resolve({ data: opts.rows ?? [ROW], error: null }),
      in: (_c: string, values: string[]) =>
        Promise.resolve(
          table === "google_calendar_connections"
            ? {
                data:
                  opts.scope === null
                    ? []
                    : [{ id: "c1", user_id: "host-1", google_email: "host@fund.com", granted_scope: opts.scope ?? READ }],
                error: null,
              }
            : { data: values.filter((v) => (opts.seen ?? []).includes(v)).map((v) => ({ external_id: v })), error: null },
        ),
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
      delete: () => {
        deletes.push(table);
        return { lte: () => Promise.resolve({ error: null }), eq: () => Promise.resolve({ error: null }) };
      },
    });
    return chain;
  };
  return { client: { from } as never, updates, inserts, deletes };
}

function fakeGmail(response: unknown | number) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (typeof response === "number") return new Response("{}", { status: response });
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  ingest.mockReset();
  ingest.mockResolvedValue({ ok: true, duplicate: false, threadId: "thr-1", created: false });
});

const tokenFor = async () => "tok";

describe("syncTrackedThreads", () => {
  it("reads only the tracked thread and puts the reply on the meeting", async () => {
    const db = makeDb();
    const gmail = fakeGmail({
      messages: [
        // The follow-up itself: already recorded when it was sent.
        msg("g-sent", "Host <host@fund.com>", [{ name: "X-FundExecs-Origin", value: "1" }]),
        msg("g-reply", "Sarah Chen <sarah@acme.com>"),
      ],
    });
    const r = await syncTrackedThreads(db.client, { now: NOW, fetchImpl: gmail.fetchImpl, tokenFor });

    expect(gmail.calls).toEqual(["https://gmail.googleapis.com/gmail/v1/users/me/threads/gth1?format=full"]);
    expect(r).toMatchObject({ threads: 1, ingested: 1 });
    expect(ingest).toHaveBeenCalledTimes(1);
    const [, orgId, channel, event] = ingest.mock.calls[0] as [unknown, string, string, Record<string, any>];
    expect(orgId).toBe("org-1");
    expect(channel).toBe(TRACKED_CHANNEL);
    expect(event.eventId).toBe("gmail:host-1:g-reply");
    expect(event.thread.meetingId).toBe("m1");
    expect(event.thread.threadKey).toBe("email:sarah@acme.com:follow-up: series b sync");
    expect(db.inserts).toEqual([
      expect.objectContaining({ row: expect.objectContaining({ external_id: "gmail:host-1:g-sent", detail: "skipped: sent_by_app" }) }),
    ]);
  });

  it("skips messages it has already ingested", async () => {
    const db = makeDb({ seen: ["gmail:host-1:g-reply"] });
    const gmail = fakeGmail({ messages: [msg("g-reply", "Sarah <sarah@acme.com>")] });
    await syncTrackedThreads(db.client, { now: NOW, fetchImpl: gmail.fetchImpl, tokenFor });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("asks for a reconnect when the member's grant cannot read mail", async () => {
    const db = makeDb({ scope: "openid email https://www.googleapis.com/auth/gmail.send" });
    const gmail = fakeGmail({ messages: [] });
    const r = await syncTrackedThreads(db.client, { now: NOW, fetchImpl: gmail.fetchImpl, tokenFor });
    expect(r.needsReconnect).toBe(1);
    expect(gmail.calls).toEqual([]);
    expect(db.updates.at(-1)?.patch).toMatchObject({ last_error: MISSING_SCOPE_ERROR });
  });

  it("stops tracking a thread that was deleted from the mailbox", async () => {
    const db = makeDb();
    const gmail = fakeGmail(404);
    await syncTrackedThreads(db.client, { now: NOW, fetchImpl: gmail.fetchImpl, tokenFor });
    // Once for the expiry sweep, once for this thread.
    expect(db.deletes).toEqual(["tracked_mail_threads", "tracked_mail_threads"]);
  });
});

describe("helpers", () => {
  it("knows a read grant when it sees one", () => {
    expect(grantCanRead(READ)).toBe(true);
    expect(grantCanRead("openid email")).toBe(false);
    expect(grantCanRead(null)).toBe(false);
  });

  it("rechecks every half hour, and a missing scope only daily", () => {
    expect(isTrackedThreadDue({ last_checked_at: null, last_error: null }, NOW)).toBe(true);
    expect(isTrackedThreadDue({ last_checked_at: "2026-10-03T11:45:00Z", last_error: null }, NOW)).toBe(false);
    expect(isTrackedThreadDue({ last_checked_at: "2026-10-03T11:00:00Z", last_error: null }, NOW)).toBe(true);
    expect(isTrackedThreadDue({ last_checked_at: "2026-10-03T06:00:00Z", last_error: MISSING_SCOPE_ERROR }, NOW)).toBe(false);
  });
});
