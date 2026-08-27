// The reminder button's server half. These emails reach real, often external
// inboxes, so what matters is when it refuses and when it stamps the cooldown.
const authMock = jest.fn();
const from = jest.fn();
const sendEmailMock = jest.fn();
const auditMock = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({ from }) }));
jest.mock("@/lib/email", () => ({
  ...jest.requireActual("@/lib/email"),
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
jest.mock("@/lib/dashboard/audit", () => ({
  writeDashboardAudit: (...args: unknown[]) => auditMock(...args),
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

function mockDb(row: Record<string, unknown> | null, updateError: { message: string } | null = null) {
  updates = [];
  from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    }),
    update(payload: Record<string, unknown>) {
      updates.push(payload);
      return { eq: () => ({ eq: async () => ({ error: updateError }) }) };
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

  it("does not stamp the cooldown when nothing was sent", async () => {
    // No mailbox connected. Locking the host out for ten minutes with nothing
    // to show for it would be the worst of both outcomes.
    sendEmailMock.mockResolvedValue({ ok: false, channel: "in-app", detail: "no mailbox connected" });
    mockDb(meetingRow());

    const res = await POST(req(), { params });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/no mailbox is connected/i);
    expect(updates).toHaveLength(0);
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

describe("POST /api/meetings/[id]/remind — a cooldown that would not stick", () => {
  it("says so rather than reporting a clean send", async () => {
    // supabase-js resolves with { error } instead of throwing, so discarding
    // this result would be a silent lost write — and the cooldown is the only
    // thing between a second click and a second email in a guest's inbox.
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    mockDb(meetingRow(), { message: "permission denied for table live_meetings" });
    const res = await POST(req(), { params });
    const json = await res.json();

    // The emails did go out, so this is not a failure.
    expect(res.status).toBe(200);
    expect(json.sent).toBe(1);
    expect(json.warning).toMatch(/cooldown could not be recorded/i);
    warn.mockRestore();
  });

  it("stays quiet when the stamp lands", async () => {
    mockDb(meetingRow());
    const json = await (await POST(req(), { params })).json();
    expect(json.warning).toBeUndefined();
  });

  it("records in the audit trail whether the cooldown stuck", async () => {
    const warn = jest.spyOn(console, "error").mockImplementation(() => {});
    mockDb(meetingRow(), { message: "permission denied" });
    await POST(req(), { params });
    expect(auditMock.mock.calls[0][0].afterState).toMatchObject({ cooldownRecorded: false });
    warn.mockRestore();
  });
});
