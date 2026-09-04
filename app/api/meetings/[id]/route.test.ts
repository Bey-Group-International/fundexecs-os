const authMock = jest.fn();
const from = jest.fn();
const updateMeetingMock = jest.fn();
const deleteMeetingLocalMock = jest.fn();
const hasServiceEnvMock = jest.fn();
const sendMeetingInvitesMock = jest.fn();
const sendMeetingUpdatesMock = jest.fn();
const sendBookingEmailsMock = jest.fn();
const loadLiveBookingMock = jest.fn();
const rescheduleBookingMock = jest.fn();
const cancelBookingMock = jest.fn();

// A stand-in for the real error class: the route branches on `instanceof`, so
// the mock has to hand back something that actually is one.
class SlotUnavailable extends Error {}

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from }),
  createServiceClient: () => ({ from }),
  hasSupabaseServiceEnv: () => hasServiceEnvMock(),
}));

jest.mock("@/lib/meetings/service", () => ({
  updateMeeting: (...args: unknown[]) => updateMeetingMock(...args),
  deleteMeetingLocal: (...args: unknown[]) => deleteMeetingLocalMock(...args),
  buildMeetingInviteUrl: (origin: string, code: string) => `${origin}/meeting-invite/${code}`,
}));

jest.mock("@/lib/meetings/invite", () => ({
  ...jest.requireActual("@/lib/meetings/invite"),
  sendMeetingInvites: (...args: unknown[]) => sendMeetingInvitesMock(...args),
}));

jest.mock("@/lib/meetings/meeting-updates", () => ({
  ...jest.requireActual("@/lib/meetings/meeting-updates"),
  sendMeetingUpdates: (...args: unknown[]) => sendMeetingUpdatesMock(...args),
}));

jest.mock("@/lib/meetings/scheduling-email", () => ({
  sendBookingEmails: (...args: unknown[]) => sendBookingEmailsMock(...args),
}));

jest.mock("@/lib/meetings/scheduling-service", () => ({
  SlotUnavailableError: SlotUnavailable,
  loadLiveBookingByMeetingId: (...args: unknown[]) => loadLiveBookingMock(...args),
  rescheduleBooking: (...args: unknown[]) => rescheduleBookingMock(...args),
  cancelBooking: (...args: unknown[]) => cancelBookingMock(...args),
}));

import { NextRequest } from "next/server";
import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };

function req(body: unknown = {}) {
  return new NextRequest("http://localhost/api/meetings/m1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// A chainable query stub. `maybeSingle` serves the prior-row load; `limit`
// serves the conflict-candidate query — so one builder covers both reads.
function makeBuilder(opts: { maybeSingle?: unknown; limit?: unknown; in?: unknown } = {}) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    neq: () => b,
    gte: () => b,
    lt: () => b,
    order: () => b,
    maybeSingle: async () => opts.maybeSingle ?? { data: null },
    limit: async () => opts.limit ?? { data: [] },
    // The member-directory lookup ends on .in(); every other read ends on
    // .maybeSingle() or .limit().
    in: async () => opts.in ?? { data: [] },
  };
  return b;
}

/**
 * A client whose live_meetings reads serve `prior` and whose member-directory
 * reads serve `team`, so a test can put real teammates behind the name a host
 * typed into the attendee box.
 */
function withDirectory(prior: unknown, team: Array<{ full_name: string | null; email: string }>) {
  return (table: string) => {
    if (table === "organization_members") {
      return makeBuilder({ limit: { data: team.map((_, i) => ({ principal_id: `p${i}` })) } });
    }
    if (table === "principals") return makeBuilder({ in: { data: team } });
    return makeBuilder({ maybeSingle: { data: prior } });
  };
}

const PRIOR_ROW = {
  attendees: [],
  room_code: "abc",
  is_draft: false,
  host_id: "u1",
  scheduled_at: "2026-07-10T10:00:00.000Z",
  duration_minutes: 60,
  title: "Quarterly review",
  timezone: "America/New_York",
};

const GUESTS = [
  { name: "Ada", email: "ada@lp.test", type: "external" as const },
  { name: "Ben", email: "ben@lp.test", type: "external" as const },
];

/** A live booking whose meeting is the one under edit. */
function bookingCtx(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      id: "b1",
      invitee_name: "Ada",
      invitee_email: "ada@lp.test",
      invitee_timezone: "Europe/London",
      manage_token: "tok",
      starts_at: "2026-07-10T10:00:00.000Z",
      ends_at: "2026-07-10T11:00:00.000Z",
      ...(overrides.booking as object ?? {}),
    },
    page: { display_name: "Nia", timezone: "America/New_York", slug: "nia" },
    eventType: { title: "Intro call", duration_minutes: 60 },
    roomCode: "abc",
  };
}
const OVERLAPPING_CANDIDATE = {
  id: "other",
  title: "Board",
  scheduled_at: "2026-07-10T10:00:00.000Z",
  duration_minutes: 60,
  host_id: "u1", // shares the host with the meeting being rescheduled
  attendees: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" },
  });
  // Default: no prior row and no candidates, so conflict detection is skipped.
  from.mockReturnValue(makeBuilder());
  // Default: no service credentials, so the booking side stays out of the way
  // of the tests that are only about meetings.
  hasServiceEnvMock.mockReturnValue(false);
  loadLiveBookingMock.mockResolvedValue(null);
  sendMeetingInvitesMock.mockResolvedValue({ sent: 0, total: 0 });
  sendMeetingUpdatesMock.mockResolvedValue({ sent: 0, total: 0 });
  sendBookingEmailsMock.mockResolvedValue({ sent: 0 });
});

describe("/api/meetings/[id]", () => {
  it("patches meeting fields through the service", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    const res = await PATCH(req({
      title: "Updated",
      durationMinutes: 45,
      priority: "high",
      tags: ["LP", "Q3"],
      syncMode: "pending_external",
    }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
      expect.objectContaining({
        title: "Updated",
        durationMinutes: 45,
        priority: "high",
        tags: ["LP", "Q3"],
        syncMode: "pending_external",
      }),
    );
  });

  it("returns 409 when a reschedule conflicts with a shared meeting", async () => {
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW }, limit: { data: [OVERLAPPING_CANDIDATE] } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30 }), params);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflicts.map((c: { id: string }) => c.id)).toEqual(["other"]);
    expect(updateMeetingMock).not.toHaveBeenCalled();
  });

  it("saves a conflicting reschedule when allowConflict is set", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW }, limit: { data: [OVERLAPPING_CANDIDATE] } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30, allowConflict: true }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalled();
  });

  it("does not flag a reschedule that overlaps an unrelated meeting", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(
      makeBuilder({
        maybeSingle: { data: PRIOR_ROW },
        limit: { data: [{ ...OVERLAPPING_CANDIDATE, host_id: "someone-else", attendees: [{ email: "x@y.z" }] }] },
      }),
    );

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30 }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalled();
  });

  it("tells the guests already on a meeting when it moves", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    sendMeetingUpdatesMock.mockResolvedValue({ sent: 2, total: 2 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notified: 2 });
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({
        emails: ["ada@lp.test", "ben@lp.test"],
        roomCode: "abc",
        title: "Quarterly review",
        timezone: "America/New_York",
        startIso: "2026-07-11T15:00:00.000Z",
        previousStartIso: "2026-07-10T10:00:00.000Z",
      }),
    );
  });

  it("stays quiet when an edit leaves the timing alone", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ title: "Quarterly review (final)", agenda: "1. Numbers" }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("treats a re-sent identical time as no change", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    // Same instant, different spelling — a save must not read as a reschedule.
    const res = await PATCH(req({ scheduledAt: "2026-07-10T06:00:00.000-04:00", durationMinutes: 60 }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("invites a newly added guest instead of mailing them a reschedule", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    sendMeetingInvitesMock.mockResolvedValue({ sent: 1, total: 1 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: [GUESTS[0]] } } }));

    const res = await PATCH(
      req({ scheduledAt: "2026-07-11T15:00:00.000Z", attendees: GUESTS }),
      params,
    );

    expect(res.status).toBe(200);
    // Ben is new: one invite carrying the new time, not an "it moved" notice.
    // The invitation has to say when — and reach his calendar — or he is left
    // with a join link and no idea what to do with it.
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ["ben@lp.test"],
        meetingId: "m1",
        startIso: "2026-07-11T15:00:00.000Z",
        durationMinutes: 60,
        hostEmail: "u@test",
        whenLabel: expect.stringContaining("2026"),
        // The host is the organizer here, not an audience for their own meeting.
        notifyHost: false,
      }),
    );
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({ emails: ["ada@lp.test"] }),
    );
  });

  it("emails a teammate added by name alone", async () => {
    // The internal-attendee box asks for people, not addresses. Before the
    // directory lookup a name with no "@" in it reached nobody.
    updateMeetingMock.mockResolvedValue({ ok: true });
    sendMeetingInvitesMock.mockResolvedValue({ sent: 1, total: 1 });
    from.mockImplementation(
      withDirectory({ ...PRIOR_ROW, attendees: [] }, [{ full_name: "Mike Ross", email: "mike.ross@fund.test" }]),
    );

    const res = await PATCH(req({ attendees: [{ name: "Mike Ross", type: "internal" }] }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ invited: 1, uninvited: 0 });
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
      expect.objectContaining({ emails: ["mike.ross@fund.test"] }),
    );
    // The address is stored too, so a later reschedule reaches them as well.
    expect(updateMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "m1",
      expect.objectContaining({ attendees: [{ name: "Mike Ross", type: "internal", email: "mike.ross@fund.test" }] }),
    );
  });

  it("reports an attendee it could not place instead of dropping them silently", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockImplementation(withDirectory({ ...PRIOR_ROW, attendees: [] }, []));

    const res = await PATCH(req({ attendees: [{ name: "Someone Outside", type: "external" }] }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ invited: 0, uninvited: 1 });
    expect(sendMeetingInvitesMock).not.toHaveBeenCalled();
  });

  it("tells a dropped guest they are off the meeting", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ attendees: [GUESTS[0]] }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "removed",
      expect.objectContaining({ emails: ["ben@lp.test"] }),
    );
  });

  it("leaves draft meetings unnotified", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, is_draft: true, attendees: GUESTS } } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("moves a link booking with the meeting and mails the invitee once", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    hasServiceEnvMock.mockReturnValue(true);
    loadLiveBookingMock.mockResolvedValue(bookingCtx());
    rescheduleBookingMock.mockResolvedValue(
      bookingCtx({ booking: { starts_at: "2026-07-11T15:00:00.000Z", ends_at: "2026-07-11T16:00:00.000Z" } }),
    );
    sendBookingEmailsMock.mockResolvedValue({ sent: 1 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(res.status).toBe(200);
    expect(rescheduleBookingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2026-07-11T15:00:00.000Z",
      expect.objectContaining({ enforceAvailability: false }),
    );
    expect(sendBookingEmailsMock).toHaveBeenCalledWith(
      "rescheduled_by_host",
      expect.objectContaining({
        inviteeEmail: "ada@lp.test",
        previousStartIso: "2026-07-10T10:00:00.000Z",
      }),
    );
    // Ada is the invitee: she gets the booking email, not the guest notice too.
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({ emails: ["ben@lp.test"] }),
    );
  });

  it("aborts the edit when the new time collides with another booking", async () => {
    hasServiceEnvMock.mockReturnValue(true);
    loadLiveBookingMock.mockResolvedValue(bookingCtx());
    rescheduleBookingMock.mockRejectedValue(new SlotUnavailable("That time was just taken."));
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(res.status).toBe(409);
    // The booking is the gate: nothing about the meeting may be written.
    expect(updateMeetingMock).not.toHaveBeenCalled();
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("deletes meetings locally by default", async () => {
    deleteMeetingLocalMock.mockResolvedValue({ ok: true });
    const res = await DELETE(new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE" }), params);

    expect(res.status).toBe(200);
    expect(deleteMeetingLocalMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
    );
  });

  it("tells the guests when a meeting is cancelled", async () => {
    deleteMeetingLocalMock.mockResolvedValue({ ok: true });
    sendMeetingUpdatesMock.mockResolvedValue({ sent: 2, total: 2 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await DELETE(
      new NextRequest("http://localhost/api/meetings/m1", {
        method: "DELETE",
        body: JSON.stringify({ reason: "Deal closed early" }),
      }),
      params,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notified: 2 });
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "cancelled",
      expect.objectContaining({
        emails: ["ada@lp.test", "ben@lp.test"],
        title: "Quarterly review",
        reason: "Deal closed early",
      }),
    );
  });

  it("cancels the link booking before deleting the meeting it belongs to", async () => {
    deleteMeetingLocalMock.mockResolvedValue({ ok: true });
    hasServiceEnvMock.mockReturnValue(true);
    loadLiveBookingMock.mockResolvedValue(bookingCtx());
    cancelBookingMock.mockResolvedValue(bookingCtx());
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await DELETE(new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE" }), params);

    expect(res.status).toBe(200);
    expect(cancelBookingMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), "host", null);
    expect(cancelBookingMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMeetingLocalMock.mock.invocationCallOrder[0],
    );
    expect(sendBookingEmailsMock).toHaveBeenCalledWith(
      "cancelled_by_host",
      expect.objectContaining({ inviteeEmail: "ada@lp.test" }),
    );
    // The invitee is covered by the booking email, so the guest notice skips her.
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "cancelled",
      expect.objectContaining({ emails: ["ben@lp.test"] }),
    );
  });
});
