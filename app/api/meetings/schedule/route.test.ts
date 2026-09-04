const authMock = jest.fn();
const from = jest.fn();
const saveScheduledMeetingMock = jest.fn();
const sendMeetingInvitesMock = jest.fn();
const loadBlockConflictsMock = jest.fn();
const mailboxForMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from, auth: { getUser: async () => ({ data: { user: { email: "u@test" } } }) } }),
}));

jest.mock("@/lib/meetings/service", () => ({
  saveScheduledMeeting: (...args: unknown[]) => saveScheduledMeetingMock(...args),
  syncMeetingExternal: jest.fn(),
  buildMeetingInviteUrl: (origin: string, code: string) => `${origin}/meeting-invite/${code}`,
  buildMeetingRoomUrl: (origin: string, code: string) => `${origin}/meetings/${code}`,
}));

jest.mock("@/lib/meetings/invite", () => ({
  ...jest.requireActual("@/lib/meetings/invite"),
  sendMeetingInvites: (...args: unknown[]) => sendMeetingInvitesMock(...args),
}));

jest.mock("@/lib/meetings/blocks.server", () => ({
  loadBlockConflicts: (...args: unknown[]) => loadBlockConflictsMock(...args),
}));

jest.mock("@/lib/meetings/mailbox.server", () => ({
  mailboxFor: (...args: unknown[]) => mailboxForMock(...args),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/schedule", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** A chainable stub: `.limit()` ends the conflict read, `.in()` the directory. */
function makeBuilder(opts: { limit?: unknown; in?: unknown; range?: unknown } = {}) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    neq: () => b,
    gte: () => b,
    lt: () => b,
    limit: async () => opts.limit ?? { data: [] },
    // The member-directory reads page with .range(); a second page comes back
    // empty, which is what ends the loop.
    range: async (from: number) => (from === 0 ? (opts.range ?? { data: [] }) : { data: [] }),
    in: async () => opts.in ?? { data: [] },
  };
  return b;
}

function withTeam(team: Array<{ full_name: string | null; email: string }>) {
  return (table: string) => {
    if (table === "organization_members") {
      return makeBuilder({ range: { data: team.map((_, i) => ({ principal_id: `p${i}` })) } });
    }
    if (table === "principals") return makeBuilder({ in: { data: team } });
    return makeBuilder();
  };
}

const VALID = {
  title: "Quarterly review",
  meetingType: "internal_strategy",
  date: "2026-09-10",
  startTime: "10:00",
  endTime: "11:00",
  timezone: "America/New_York",
};

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org1", userId: "u1", role: "owner", email: "host@fund.test" },
  });
  from.mockImplementation(withTeam([]));
  loadBlockConflictsMock.mockResolvedValue([]);
  mailboxForMock.mockResolvedValue({ ok: true, token: "tok", email: "host@fund.test", source: "member" });
  sendMeetingInvitesMock.mockResolvedValue({ sent: 0, total: 0 });
  saveScheduledMeetingMock.mockResolvedValue({
    id: "m1",
    roomCode: "abc-def",
    scheduledAt: "2026-09-10T14:00:00.000Z",
    durationMinutes: 60,
    isDraft: false,
    lockedAt: "2026-09-01T00:00:00.000Z",
    internalCalendarEventId: "cal1",
  });
});

describe("POST /api/meetings/schedule", () => {
  it("emails every attendee who has an address, and the host", async () => {
    sendMeetingInvitesMock.mockResolvedValue({ sent: 3, total: 3 });

    const res = await POST(
      req({
        ...VALID,
        attendees: [
          { name: "Ada", email: "ada@lp.test", type: "external" },
          { name: "Ben", email: "ben@lp.test", type: "external" },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ invited: 3, uninvited: 0 });
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["ada@lp.test", "ben@lp.test"],
        hostEmail: "host@fund.test",
        meetingId: "m1",
        startIso: "2026-09-10T14:00:00.000Z",
        whenLabel: expect.stringContaining("2026"),
      }),
    );
  });

  it("looks a teammate entered by name up in the member directory", async () => {
    from.mockImplementation(withTeam([{ full_name: "Mike Ross", email: "mike.ross@fund.test" }]));
    sendMeetingInvitesMock.mockResolvedValue({ sent: 2, total: 2 });

    const res = await POST(req({ ...VALID, attendees: [{ name: "Mike", type: "internal" }] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ uninvited: 0 });
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ emails: ["mike.ross@fund.test"] }),
    );
    // Stored with the address, so every later notice reaches them too.
    expect(saveScheduledMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attendees: [{ name: "Mike", type: "internal", email: "mike.ross@fund.test" }],
      }),
    );
  });

  it("counts back an attendee nobody can email", async () => {
    const res = await POST(req({ ...VALID, attendees: [{ name: "A Stranger", type: "external" }] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ uninvited: 1 });
    // The host still gets their own confirmation and calendar entry.
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(expect.objectContaining({ emails: [] }));
  });

  it("does not email anyone about a draft", async () => {
    saveScheduledMeetingMock.mockResolvedValue({
      id: "m1",
      roomCode: "abc-def",
      scheduledAt: "2026-09-10T14:00:00.000Z",
      durationMinutes: 60,
      isDraft: true,
      lockedAt: null,
      internalCalendarEventId: null,
    });

    const res = await POST(
      req({ ...VALID, draft: true, attendees: [{ name: "Ada", email: "ada@lp.test", type: "external" }] }),
    );

    expect(res.status).toBe(200);
    expect(sendMeetingInvitesMock).not.toHaveBeenCalled();
  });

  it("says so when the organization has no mailbox to send from", async () => {
    // Without this the host sees a saved meeting and "invited 0", which reads
    // as "nobody had an address" rather than "nothing can be sent at all".
    mailboxForMock.mockResolvedValue({ ok: false, problem: "not_connected" });

    const res = await POST(req({ ...VALID, attendees: [{ name: "Ada", email: "ada@lp.test", type: "external" }] }));

    const body = await res.json();
    expect(body.mailboxConnected).toBe(false);
    expect(body.mailboxProblem).toContain("Settings");
    // The send is still attempted — a deploy-level credential can still carry
    // it — but it goes out with no per-member credentials.
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: undefined }),
    );
  });

  it("reports a connected mailbox on the happy path", async () => {
    const res = await POST(req({ ...VALID, attendees: [] }));
    expect(await res.json()).toMatchObject({ mailboxConnected: true, mailboxProblem: null });
  });

  it("rejects a malformed attendee list instead of crashing on it", async () => {
    const res = await POST(req({ ...VALID, attendees: [null] }));
    expect(res.status).toBe(422);
    expect(saveScheduledMeetingMock).not.toHaveBeenCalled();
  });

  it("does not go looking for a directory when every attendee has an address", async () => {
    await POST(req({ ...VALID, attendees: [{ name: "Ada", email: "ada@lp.test", type: "external" }] }));
    expect(from).not.toHaveBeenCalledWith("organization_members");
  });
});
