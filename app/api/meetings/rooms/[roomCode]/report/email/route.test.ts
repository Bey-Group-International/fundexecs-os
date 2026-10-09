/**
 * Emailing a meeting's summary: the host sends it, to the people who were in
 * the room, once; each copy links to that person's own private read-only
 * report (not a login wall); and each delivered copy is recorded as an inbox
 * thread on the MEETING's organisation so the reply lands beside it.
 */
const requireOrgContext = jest.fn();
const loadReportForExport = jest.fn();
const mailboxFor = jest.fn();
const sendEmail = jest.fn();
const recordFollowUpThreads = jest.fn();

/** What the route wrote back to the meeting row. */
const updates: Record<string, unknown>[] = [];
let updateError: { message: string } | null = null;

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        update: (row: Record<string, unknown>) => {
          if (table === "live_meetings") updates.push(row);
          return b;
        },
        eq: () => Promise.resolve({ error: updateError }),
      };
      return b;
    },
  }),
  createServiceClient: () => ({ service: true }),
  hasSupabaseServiceEnv: () => true,
}));
jest.mock("@/lib/meetings/report-export.server", () => ({ loadReportForExport: (...a: unknown[]) => loadReportForExport(...a) }));
jest.mock("@/lib/meetings/mailbox.server", () => ({ mailboxFor: (...a: unknown[]) => mailboxFor(...a) }));
jest.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
jest.mock("@/lib/meetings/follow-up-threads.server", () => ({
  recordFollowUpThreads: (...a: unknown[]) => recordFollowUpThreads(...a),
}));
jest.mock("@/lib/meetings/report-share.server", () => ({
  reportShareUrl: (room: string, email: string) => `https://app.test/r/report/${room}-${email}`,
}));

import { POST } from "./route";

const LOADED = {
  meetingId: "m1",
  roomCode: "abc-def",
  // Deliberately NOT the caller's active organisation (org-1): the threads
  // belong to the meeting's.
  organizationId: "org-meeting",
  hostId: "u1",
  attended: true,
  // Invited, and never joined. Not written to.
  attendees: [{ name: "Never Joined", email: "nj@acme.com" }],
  // In the room: two with addresses, one guest without.
  present: [
    { name: "Ana Lopez", email: "ana@acme.com" },
    { name: "Bo Chen", email: "bo@x.io" },
    { name: "Dana", email: null },
  ],
  title: "Series B sync",
  createdAt: null,
  startedAt: null,
  endedAt: null,
  scheduledAt: null,
  summarySentAt: null as string | null,
  summary: "We agreed the terms.",
  keyPoints: [],
  actionItems: [],
  analysis: null,
  fullTranscript: null,
  consent: null,
  kind: "meeting",
  hasReport: true,
  recording: null,
  chat: null,
};

function call(body: unknown = {}) {
  return POST(
    new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ roomCode: "abc-def" }) },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;
  updateError = null;
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "u1", email: "host@fund.com" } });
  loadReportForExport.mockResolvedValue(LOADED);
  mailboxFor.mockResolvedValue({ ok: true, token: "tok", email: "host@fund.com", source: "member" });
  sendEmail.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent", gmailThreadId: "gt" });
});

describe("who may send it", () => {
  it("refuses anyone but the host, even an attendee", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "attendee-2", email: "a2@x.io" } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("who it goes to", () => {
  it("writes to the people who were in the room, and not to invitees who never joined", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 2, total: 2, unreachable: ["Dana"] });
    const to = sendEmail.mock.calls.map(([a]) => a.to.email).sort();
    expect(to).toEqual(["ana@acme.com", "bo@x.io"]);
    expect(to).not.toContain("nj@acme.com");
  });

  it("links each copy to that recipient's own private report", async () => {
    await call();
    const byEmail = Object.fromEntries(sendEmail.mock.calls.map(([a]) => [a.to.email, a.htmlBody as string]));
    expect(byEmail["ana@acme.com"]).toContain("https://app.test/r/report/abc-def-ana@acme.com");
    expect(byEmail["ana@acme.com"]).not.toContain("bo@x.io");
    expect(byEmail["bo@x.io"]).toContain("https://app.test/r/report/abc-def-bo@x.io");
    expect(sendEmail.mock.calls[0][0].subject).toBe("Summary: Series B sync");
  });

  it("says so when nobody in the room can be reached", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, present: [{ name: "Dana", email: null }] });
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Dana/);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sending it once", () => {
  // The button had no memory: a second press mailed everyone again and doubled
  // the inbox threads.
  it("records the first send on the meeting", async () => {
    await call();
    expect(updates).toHaveLength(1);
    expect(typeof updates[0].summary_sent_at).toBe("string");
  });

  it("answers a second press with when it went, and mails nobody", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, summarySentAt: "2026-10-09T10:00:00.000Z" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadySent: true, sentAt: "2026-10-09T10:00:00.000Z", sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordFollowUpThreads).not.toHaveBeenCalled();
  });

  it("sends again only when told to", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, summarySentAt: "2026-10-09T10:00:00.000Z" });
    const res = await call({ resend: true });
    expect(await res.json()).toMatchObject({ sent: 2 });
  });

  it("does not record a send that reached nobody, so the host can try again", async () => {
    sendEmail.mockResolvedValue({ ok: false, channel: "gmail", detail: "refused" });
    await call();
    expect(updates).toEqual([]);
  });

  it("still reports the send when the marker could not be written", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    updateError = { message: "denied" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 2 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the conversation it starts", () => {
  it("records every delivered copy on the MEETING's organisation, not the caller's", async () => {
    await call();
    expect(recordFollowUpThreads).toHaveBeenCalledTimes(1);
    const [, input] = recordFollowUpThreads.mock.calls[0];
    expect(input).toMatchObject({
      orgId: "org-meeting",
      meetingId: "m1",
      hostId: "u1",
      subject: "Summary: Series B sync",
      kind: "summary",
      mailbox: { source: "member", email: "host@fund.com" },
    });
    expect(input.sends.map((s: { recipient: { email: string } }) => s.recipient.email).sort()).toEqual(["ana@acme.com", "bo@x.io"]);
  });

  it("falls back to the caller's organisation only when the meeting has none", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, organizationId: null });
    await call();
    expect(recordFollowUpThreads.mock.calls[0][1]).toMatchObject({ orgId: "org-1" });
  });
});

it("still refuses without a mailbox, and records nothing", async () => {
  mailboxFor.mockResolvedValue({ ok: false, problem: "not_connected" });
  const res = await call();
  expect(res.status).toBe(400);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(recordFollowUpThreads).not.toHaveBeenCalled();
  expect(updates).toEqual([]);
});
