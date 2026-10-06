/**
 * Emailing a meeting's summary: each invitee's copy links to their own private
 * read-only report (not a login wall), and each delivered copy is recorded as an
 * inbox thread on the meeting so the reply lands beside it.
 */
const requireOrgContext = jest.fn();
const loadReportForExport = jest.fn();
const mailboxFor = jest.fn();
const sendEmail = jest.fn();
const recordFollowUpThreads = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({}),
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
  organizationId: "org-1",
  hostId: "u1",
  attended: true,
  attendees: [
    { name: "Ana Lopez", email: "ana@acme.com" },
    { name: "Bo Chen", email: "bo@x.io" },
  ],
  present: [],
  title: "Series B sync",
  createdAt: null,
  startedAt: null,
  endedAt: null,
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

function call() {
  return POST(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ roomCode: "abc-def" }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "u1", email: "host@fund.com" } });
  loadReportForExport.mockResolvedValue(LOADED);
  mailboxFor.mockResolvedValue({ ok: true, token: "tok", email: "host@fund.com", source: "member" });
  sendEmail.mockResolvedValue({ ok: true, channel: "gmail", detail: "sent", gmailThreadId: "gt" });
});

it("links each copy to that recipient's own private report", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ sent: 2, total: 2 });
  const byEmail = Object.fromEntries(sendEmail.mock.calls.map(([a]) => [a.to.email, a.htmlBody as string]));
  expect(byEmail["ana@acme.com"]).toContain("https://app.test/r/report/abc-def-ana@acme.com");
  expect(byEmail["ana@acme.com"]).not.toContain("bo@x.io");
  expect(byEmail["bo@x.io"]).toContain("https://app.test/r/report/abc-def-bo@x.io");
  expect(sendEmail.mock.calls[0][0].subject).toBe("Summary: Series B sync");
});

it("records every delivered copy on the meeting's inbox threads", async () => {
  await call();
  expect(recordFollowUpThreads).toHaveBeenCalledTimes(1);
  const [, input] = recordFollowUpThreads.mock.calls[0];
  expect(input).toMatchObject({
    orgId: "org-1",
    meetingId: "m1",
    hostId: "u1",
    subject: "Summary: Series B sync",
    kind: "summary",
    mailbox: { source: "member", email: "host@fund.com" },
  });
  expect(input.sends.map((s: { recipient: { email: string } }) => s.recipient.email)).toEqual(["ana@acme.com", "bo@x.io"]);
});

it("still refuses without a mailbox, and records nothing", async () => {
  mailboxFor.mockResolvedValue({ ok: false, problem: "not_connected" });
  const res = await call();
  expect(res.status).toBe(400);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(recordFollowUpThreads).not.toHaveBeenCalled();
});
