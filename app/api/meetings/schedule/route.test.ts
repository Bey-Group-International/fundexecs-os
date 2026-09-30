const authMock = jest.fn();
const from = jest.fn();
const saveScheduledMeetingMock = jest.fn();
const sendMeetingInvitesMock = jest.fn();
const loadBlockConflictsMock = jest.fn();
const mailboxForMock = jest.fn();
const canWriteCalendarMock = jest.fn();
const syncMeetingExternalMock = jest.fn();
const loadExternalConflictsMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from, auth: { getUser: async () => ({ data: { user: { email: "u@test" } } }) } }),
}));

// Mocked rather than driven through the fake client: the route asks whether the
// host has a calendar it can write to, and that is a two-query lookup whose
// shape has nothing to do with what these tests are about.
jest.mock("@/lib/calendar/google-write.server", () => ({
  canWriteCalendar: (...args: unknown[]) => canWriteCalendarMock(...args),
}));

jest.mock("@/lib/meetings/service", () => ({
  saveScheduledMeeting: (...args: unknown[]) => saveScheduledMeetingMock(...args),
  syncMeetingExternal: (...args: unknown[]) => syncMeetingExternalMock(...args),
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

jest.mock("@/lib/meetings/conflicts.server", () => ({
  loadExternalConflicts: (...args: unknown[]) => loadExternalConflictsMock(...args),
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
  loadExternalConflictsMock.mockResolvedValue([]);
  mailboxForMock.mockResolvedValue({ ok: true, token: "tok", email: "host@fund.test", source: "member" });
  sendMeetingInvitesMock.mockResolvedValue({ sent: 0, total: 0, attempted: 0, failed: [], reasons: [] });
  // No calendar unless a test says otherwise.
  canWriteCalendarMock.mockResolvedValue(false);
  syncMeetingExternalMock.mockResolvedValue({ ok: true, status: "synced" });
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
    sendMeetingInvitesMock.mockResolvedValue({ sent: 3, total: 3, attempted: 3, failed: [], reasons: [] });

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

// ── The host's own calendar ─────────────────────────────────────────────────
//
// The defect: syncing needed the REQUEST to carry both
// externalCalendarSyncEnabled and externalCalendarProvider, and both came from a
// checkbox and a dropdown inside a collapsed "Advanced options" section that
// defaults to off. So scheduling a meeting the ordinary way never attempted a
// push, and a host with a working Google connection never saw one arrive.

describe("putting a scheduled meeting on the host's calendar", () => {
  it("pushes it when a calendar is connected, without being asked to", async () => {
    canWriteCalendarMock.mockResolvedValue(true);

    const res = await POST(req({ ...VALID }));

    expect(res.status).toBe(200);
    expect(syncMeetingExternalMock).toHaveBeenCalledTimes(1);
    // And the row carries the flag `decideWrite` reads, so later edits keep it.
    expect(saveScheduledMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalCalendarSyncEnabled: true,
        externalCalendarProvider: "google_calendar",
      }),
    );
  });

  it("does not push when no calendar can be written to, and says so", async () => {
    canWriteCalendarMock.mockResolvedValue(false);

    const res = await POST(req({ ...VALID }));

    expect(syncMeetingExternalMock).not.toHaveBeenCalled();
    const json = (await res.json()) as { calendarNote?: string; calendarConnected?: boolean };
    expect(json.calendarConnected).toBe(false);
    // Reported as an absence, not as a failure: nothing went wrong.
    expect(json.calendarNote).toMatch(/no Google Calendar/i);
  });

  it("keeps a meeting off the calendar when the host said to", async () => {
    canWriteCalendarMock.mockResolvedValue(true);

    await POST(req({ ...VALID, externalCalendarSyncEnabled: false }));

    expect(syncMeetingExternalMock).not.toHaveBeenCalled();
    expect(saveScheduledMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ externalCalendarSyncEnabled: false, externalCalendarProvider: null }),
    );
  });

  it("never pushes a draft", async () => {
    canWriteCalendarMock.mockResolvedValue(true);
    saveScheduledMeetingMock.mockResolvedValue({
      id: "m1",
      roomCode: "abc-def",
      scheduledAt: "2026-09-10T14:00:00.000Z",
      durationMinutes: 60,
      isDraft: true,
      lockedAt: null,
      internalCalendarEventId: null,
    });

    await POST(req({ ...VALID, draft: true }));

    expect(syncMeetingExternalMock).not.toHaveBeenCalled();
  });

  // A calendar lookup is not worth a meeting. This one sits inside the same try
  // that surrounds the save, so a throw here used to be a 500 and a lost meeting.
  it("saves the meeting even when the calendar cannot be checked", async () => {
    canWriteCalendarMock.mockResolvedValue(null);

    const res = await POST(req({ ...VALID }));

    expect(res.status).toBe(200);
    expect(syncMeetingExternalMock).not.toHaveBeenCalled();
    const json = (await res.json()) as { calendarNote?: string };
    // And it does not blame a connection it could not read.
    expect(json.calendarNote).toMatch(/Could not check/i);
  });
});

// ── An invite send that reached nobody ──────────────────────────────────────

describe("reporting what the invite send achieved", () => {
  it("says something was attempted even when nothing was sent", async () => {
    // Previously the route kept only `sent`, so this was a bare `invited: 0` —
    // which the scheduling screen renders as no message at all, identical to a
    // meeting with nobody to email.
    sendMeetingInvitesMock.mockResolvedValue({
      sent: 0,
      total: 2,
      attempted: 2,
      failed: ["ada@lp.test", "host@fund.test"],
      reasons: ["Invalid Credentials"],
    });

    const res = await POST(
      req({ ...VALID, attendees: [{ name: "Ada", email: "ada@lp.test", type: "external" }] }),
    );

    expect(await res.json()).toMatchObject({
      invited: 0,
      attempted: 2,
      inviteFailures: ["ada@lp.test", "host@fund.test"],
      inviteReasons: ["Invalid Credentials"],
    });
  });

  it("reports a throw as an attempt, not as nothing to do", async () => {
    sendMeetingInvitesMock.mockRejectedValue(new Error("network down"));

    const res = await POST(req({ ...VALID }));

    const json = (await res.json()) as { attempted?: number; inviteReasons?: string[] };
    expect(json.attempted).toBeGreaterThan(0);
    expect(json.inviteReasons).toEqual(["network down"]);
  });
});

describe("POST /api/meetings/schedule over a connected calendar's busy time", () => {
  const BUSY = [{ start: "2026-09-10T14:00:00.000Z", end: "2026-09-10T14:30:00.000Z" }];

  it("refuses the save, and does not offer Save anyway", async () => {
    loadExternalConflictsMock.mockResolvedValue(BUSY);
    const res = await POST(req(VALID));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ overridable: false, busyElsewhere: BUSY });
    expect(body.error).toMatch(/busy on your connected calendar/i);
    expect(saveScheduledMeetingMock).not.toHaveBeenCalled();
  });

  it("refuses it even when asked to save anyway", async () => {
    loadExternalConflictsMock.mockResolvedValue(BUSY);
    const res = await POST(req({ ...VALID, allowConflict: true }));
    expect(res.status).toBe(409);
    expect(saveScheduledMeetingMock).not.toHaveBeenCalled();
  });

  it("still lets time blocked by hand be saved over when asked", async () => {
    loadBlockConflictsMock.mockResolvedValue([
      { id: "b1", title: "Focus", startsAt: "2026-09-10T14:00:00.000Z", endsAt: "2026-09-10T15:00:00.000Z" },
    ]);
    const warned = await POST(req(VALID));
    expect(warned.status).toBe(409);
    expect(await warned.json()).toMatchObject({ overridable: true });

    const saved = await POST(req({ ...VALID, allowConflict: true }));
    expect(saved.status).toBe(200);
  });

  it("lets a draft be kept whatever the calendar says", async () => {
    loadExternalConflictsMock.mockResolvedValue(BUSY);
    const res = await POST(req({ ...VALID, draft: true }));
    expect(res.status).toBe(200);
    expect(loadExternalConflictsMock).not.toHaveBeenCalled();
  });
});
