// The reminder button's server half. These emails reach real, often external
// inboxes, so what matters is when it refuses and when it stamps the cooldown.
const authMock = jest.fn();
const from = jest.fn();
const sendEmailMock = jest.fn();
const auditMock = jest.fn();
const mailboxMock = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({ from }) }));
jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
jest.mock("@/lib/dashboard/audit", () => ({
  writeDashboardAudit: (...args: unknown[]) => auditMock(...args),
}));
jest.mock("@/lib/meetings/mailbox.server", () => ({
  mailboxFor: (...args: unknown[]) => mailboxMock(...args),
}));
jest.mock("@/lib/site", () => ({ SITE_URL: "https://app.test" }));

import { POST } from "./route";

const FUTURE = new Date(Date.now() + 3 * 3600_000).toISOString();

function meetingRow(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Q3 LP update",
    status: "waiting",
    scheduled_at: FUTURE,
    timezone: "America/New_York",
    duration_minutes: 30,
    is_draft: false,
    deleted_at: null,
    attendees: [{ name: "Ada", email: "ada@example.com" }],
    room_code: "abc-def",
    meeting_url: null,
    last_reminder_sent_at: null,
    ...over,
  };
}

/** Captures the update payload so the cooldown stamp can be asserted. */
let updates: Array<Record<string, unknown>>;

/**
 * The cooldown is claimed with a conditional update before anything is sent, so
 * the double models both shapes: `.eq().eq().or().select().maybeSingle()` for
 * the claim, and `.eq().eq()` for the plain release afterwards.
 *
 * `claimWins: false` stands in for a concurrent request that got there first —
 * the row no longer matches the filter, so the update touches nothing.
 */
function mockDb(
  row: Record<string, unknown> | null,
  opts: {
    updateError?: { message: string } | null;
    /** Fails only the release, leaving the claim to succeed. */
    releaseError?: { message: string } | null;
    claimWins?: boolean;
  } = {},
) {
  const { updateError = null, releaseError = null, claimWins = true } = opts;
  updates = [];
  from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    }),
    update(payload: Record<string, unknown>) {
      updates.push(payload);
      // Awaitable *and* chainable: the release awaits `.eq().eq()` directly
      // while the claim carries on into `.or().select().maybeSingle()`.
      const result = {
        or: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: claimWins ? { id: "m1" } : null,
              error: updateError,
            }),
          }),
        }),
        then: (resolve: (v: { error: { message: string } | null }) => void) =>
          resolve({ error: releaseError ?? updateError }),
      };
      return { eq: () => ({ eq: () => result }) };
    },
  }));
}

function req(body: unknown = {}) {
  return new Request("http://localhost/api/meetings/m1/remind", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "m1" });

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1", email: "rae@fund.test" } });
  sendEmailMock.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent" });
  // The host's own Google grant. Every send now goes out through it.
  mailboxMock.mockResolvedValue({ ok: true, token: "host-token", email: "rae@fund.test", source: "member" });
});

describe("POST /api/meetings/[id]/remind", () => {
  it("emails every attendee and reports the count", async () => {
    mockDb(meetingRow({ attendees: [{ email: "ada@example.com" }, { email: "bo@example.com" }] }));
    const res = await POST(req(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ sent: 2, total: 2 });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock.mock.calls[0][0].subject).toContain("Reminder: Q3 LP update");
  });

  it("includes a join link built from the room code", async () => {
    mockDb(meetingRow());
    await POST(req(), { params });
    expect(sendEmailMock.mock.calls[0][0].htmlBody).toContain("https://app.test/meeting-invite/abc-def");
  });

  it("stamps the cooldown once something has gone out", async () => {
    mockDb(meetingRow());
    await POST(req(), { params });
    expect(updates.at(-1)).toHaveProperty("last_reminder_sent_at");
    expect(auditMock).toHaveBeenCalled();
  });

  it("leaves no cooldown behind when nothing was sent", async () => {
    // No mailbox connected. Locking the host out for ten minutes with nothing
    // to show for it would be the worst of both outcomes. The claim is taken
    // before the send, so what matters is that it is handed back — not that
    // no write happened.
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox connected" });
    mockDb(meetingRow({ last_reminder_sent_at: null }));

    const res = await POST(req(), { params });

    expect(res.status).toBe(502);
    // The mailbox resolved, so a zero is Gmail refusing rather than a missing
    // connection — the message names the account to check.
    expect((await res.json()).error).toMatch(/rae@fund\.test/);
    expect(updates.at(-1)).toEqual({ last_reminder_sent_at: null });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("counts a partial send rather than failing the lot", async () => {
    sendEmailMock
      .mockResolvedValueOnce({ ok: true, channel: "gmail", detail: "sent" })
      .mockResolvedValueOnce({ ok: false, channel: "gmail", detail: "bounced" });
    mockDb(meetingRow({ attendees: [{ email: "ada@example.com" }, { email: "bo@example.com" }] }));

    const json = await (await POST(req(), { params })).json();
    expect(json).toMatchObject({ sent: 1, total: 2 });
  });

  it("refuses a meeting that already started, with a reason for the host", async () => {
    mockDb(meetingRow({ scheduled_at: new Date(Date.now() - 60_000).toISOString() }));
    const res = await POST(req(), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already started/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses a second reminder inside the cooldown", async () => {
    mockDb(meetingRow({ last_reminder_sent_at: new Date(Date.now() - 60_000).toISOString() }));
    const res = await POST(req(), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/just went out/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when nobody has an address", async () => {
    mockDb(meetingRow({ attendees: [{ name: "No Email" }] }));
    const res = await POST(req(), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Nobody on this meeting/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("404s a meeting outside the caller's org", async () => {
    // The query is scoped by organization_id, so another org's meeting simply
    // is not found — never confirmed to exist.
    mockDb(null);
    expect((await POST(req(), { params })).status).toBe(404);
  });

  it("refuses an unauthenticated caller before touching anything", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    mockDb(meetingRow());

    expect((await POST(req(), { params })).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("carries an optional note through to the email", async () => {
    mockDb(meetingRow());
    await POST(req({ note: "Bring the updated deck" }), { params });
    expect(sendEmailMock.mock.calls[0][0].htmlBody).toContain("Bring the updated deck");
  });

  it("bounds a note rather than emailing an essay", async () => {
    mockDb(meetingRow());
    await POST(req({ note: "x".repeat(5000) }), { params });
    const html = sendEmailMock.mock.calls[0][0].htmlBody as string;
    expect(html).not.toContain("x".repeat(600));
  });
});

describe("POST /api/meetings/[id]/remind — the cooldown claim", () => {
  it("claims the cooldown before sending, not after", async () => {
    // Reading the timestamp and then sending leaves a window where two
    // requests both find it clear. The claim is a conditional update, so the
    // database picks the winner before any email is built.
    mockDb(meetingRow());
    await POST(req(), { params });
    expect(updates[0]).toHaveProperty("last_reminder_sent_at");
    expect(sendEmailMock).toHaveBeenCalled();
  });

  it("sends nothing when a concurrent request claimed it first", async () => {
    // The row no longer matches the filter, so the update touches nothing.
    mockDb(meetingRow(), { claimWins: false });
    const res = await POST(req(), { params });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/just went out/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("gives the claim back when the send reached nobody", async () => {
    // Otherwise a missing mailbox would lock the host out for ten minutes over
    // a send that never happened.
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox connected" });
    mockDb(meetingRow({ last_reminder_sent_at: null }));
    const res = await POST(req(), { params });

    expect(res.status).toBe(502);
    expect(updates.at(-1)).toEqual({ last_reminder_sent_at: null });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("restores the previous stamp rather than clearing it outright", async () => {
    const previous = "2026-08-27T00:00:00.000Z";
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox" });
    mockDb(meetingRow({ last_reminder_sent_at: previous }));
    await POST(req(), { params });
    expect(updates.at(-1)).toEqual({ last_reminder_sent_at: previous });
  });

  it("says so when the claim could not be given back", async () => {
    // supabase-js resolves with { error } instead of throwing, so discarding
    // this result would strand the claim silently.
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox" });
    mockDb(meetingRow(), { releaseError: { message: "permission denied" } });
    const json = await (await POST(req(), { params })).json();

    expect(json.warning).toMatch(/cooldown could not be cleared/i);
    warn.mockRestore();
  });

  it("stays quiet on a send that reached someone", async () => {
    mockDb(meetingRow());
    const json = await (await POST(req(), { params })).json();
    expect(json.warning).toBeUndefined();
    expect(auditMock).toHaveBeenCalled();
  });
});

describe("POST /api/meetings/[id]/remind — sending as the host", () => {
  it("sends through the host's own Google grant", async () => {
    // Not the org mailbox. A reminder is from a person, and the guest should
    // see that person's address.
    mockDb(meetingRow());
    await POST(req(), { params });
    expect(sendEmailMock.mock.calls[0][0].credentials).toEqual({ gmailAccessToken: "host-token" });
  });

  it("sets no From header, leaving Gmail to stamp the account", async () => {
    // Forcing a From that is not a verified alias only gets it rewritten; the
    // authenticated account's own address is the one that always matches.
    mockDb(meetingRow());
    await POST(req(), { params });
    expect(sendEmailMock.mock.calls[0][0].credentials.fromEmail).toBeUndefined();
  });

  it("refuses with an action when the host has never connected", async () => {
    mailboxMock.mockResolvedValue({ ok: false, problem: "not_connected" });
    mockDb(meetingRow());
    const res = await POST(req(), { params });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.mailbox).toBe("not_connected");
    expect(json.error).toMatch(/No Google account is connected/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("tells a calendar-only member to reconnect, not to connect", async () => {
    mailboxMock.mockResolvedValue({ ok: false, problem: "scope_missing" });
    mockDb(meetingRow());
    const json = await (await POST(req(), { params })).json();
    expect(json.error).toMatch(/^Reconnect/);
  });

  it("claims no cooldown for a send it refuses", async () => {
    // The claim is taken after the mailbox resolves. Taking it first would lock
    // the host out for ten minutes over a refusal.
    mailboxMock.mockResolvedValue({ ok: false, problem: "not_connected" });
    mockDb(meetingRow());
    await POST(req(), { params });
    expect(updates).toHaveLength(0);
  });

  it("still reports the recipients it would have reached", async () => {
    // The host asked "can I remind these people" — the count is part of the
    // answer even when the answer is no.
    mailboxMock.mockResolvedValue({ ok: false, problem: "revoked" });
    mockDb(meetingRow({ attendees: [{ email: "ada@example.com" }, { email: "bo@example.com" }] }));
    const json = await (await POST(req(), { params })).json();
    expect(json.recipients).toBe(2);
  });
});

describe("POST /api/meetings/[id]/remind — falling back to the org connection", () => {
  it("sends rather than refusing when only the org has Google connected", async () => {
    // The org-level grant already carries gmail.send. Refusing here would ask a
    // member to authorize a second Google account the app is already holding.
    mailboxMock.mockResolvedValue({ ok: true, token: "org-token", email: null, source: "organization" });
    mockDb(meetingRow());
    const res = await POST(req(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(sendEmailMock.mock.calls[0][0].credentials).toEqual({ gmailAccessToken: "org-token" });
    expect(json.sentFrom).toBe("organization");
  });

  it("says the guest saw somebody else's address", async () => {
    // The host should not learn whose address went out from the guest.
    mailboxMock.mockResolvedValue({ ok: true, token: "org-token", email: null, source: "organization" });
    mockDb(meetingRow());
    const json = await (await POST(req(), { params })).json();
    expect(json.warning).toMatch(/organization's connected Google account/);
  });

  it("stays quiet when it was the host's own account", async () => {
    mockDb(meetingRow());
    const json = await (await POST(req(), { params })).json();
    expect(json.sentFrom).toBe("member");
    expect(json.warning).toBeUndefined();
  });
});
