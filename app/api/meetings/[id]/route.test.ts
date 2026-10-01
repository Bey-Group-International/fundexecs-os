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
const loadSeriesRowsMock = jest.fn();
const setSeriesRuleMock = jest.fn();
const sendSeriesEndedMock = jest.fn();
const markSeriesOccurrenceMock = jest.fn();
const loadSeriesExternalConflictsMock = jest.fn(async () => [] as Array<{ start: string; end: string }>);

// A stand-in for the real error class: the route branches on `instanceof`, so
// the mock has to hand back something that actually is one.
class SlotUnavailable extends Error {}

const loadExternalConflictsMock = jest.fn(async () => [] as Array<{ start: string; end: string }>);
jest.mock("@/lib/meetings/conflicts.server", () => ({
  loadExternalConflicts: (...args: unknown[]) => loadExternalConflictsMock(...(args as [])),
  loadSeriesExternalConflicts: (...args: unknown[]) => loadSeriesExternalConflictsMock(...(args as [])),
}));

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
  loadSeriesRows: (...args: unknown[]) => loadSeriesRowsMock(...args),
  setSeriesRule: (...args: unknown[]) => setSeriesRuleMock(...args),
  markSeriesOccurrence: (...args: unknown[]) => markSeriesOccurrenceMock(...args),
  buildMeetingInviteUrl: (origin: string, code: string) => `${origin}/meeting-invite/${code}`,
}));

jest.mock("@/lib/meetings/invite", () => ({
  ...jest.requireActual("@/lib/meetings/invite"),
  sendMeetingInvites: (...args: unknown[]) => sendMeetingInvitesMock(...args),
}));

jest.mock("@/lib/meetings/meeting-updates", () => ({
  ...jest.requireActual("@/lib/meetings/meeting-updates"),
  sendMeetingUpdates: (...args: unknown[]) => sendMeetingUpdatesMock(...args),
  sendSeriesEnded: (...args: unknown[]) => sendSeriesEndedMock(...args),
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
function makeBuilder(opts: { maybeSingle?: unknown; limit?: unknown; in?: unknown; range?: unknown } = {}) {
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
    // The member-directory reads page with .range(); a second page comes back
    // empty, which is what ends the loop.
    range: async (from: number) => (from === 0 ? (opts.range ?? { data: [] }) : { data: [] }),
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
      return makeBuilder({ range: { data: team.map((_, i) => ({ principal_id: `p${i}` })) } });
    }
    if (table === "principals") return makeBuilder({ in: { data: team } });
    return makeBuilder({ maybeSingle: { data: prior } });
  };
}

const PRIOR_ROW = {
  attendees: [],
  room_code: "abc",
  location: "Room 3",
  meeting_url: null,
  is_draft: false,
  host_id: "u1",
  scheduled_at: "2026-07-10T10:00:00.000Z",
  duration_minutes: 60,
  title: "Quarterly review",
  timezone: "America/New_York",
};

const NEW_GUEST = { name: "Cass", email: "cass@lp.test", type: "external" as const };

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
  sendSeriesEndedMock.mockResolvedValue({ sent: 0, total: 0 });
  setSeriesRuleMock.mockResolvedValue(0);
});

describe("/api/meetings/[id]", () => {
  it("patches meeting fields through the service", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
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
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW }, limit: { data: [OVERLAPPING_CANDIDATE] } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30, allowConflict: true }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalled();
  });

  it("will not move a meeting onto time a connected calendar has taken, even when asked to", async () => {
    loadExternalConflictsMock.mockResolvedValueOnce([
      { start: "2026-07-10T10:15:00.000Z", end: "2026-07-10T10:45:00.000Z" },
    ]);
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW }, limit: { data: [] } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30, allowConflict: true }), params);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ overridable: false });
    expect(updateMeetingMock).not.toHaveBeenCalled();
  });

  it("does not flag a reschedule that overlaps an unrelated meeting", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
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
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
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

  it("tells guests a series meeting moved as that one meeting of the series", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    sendMeetingUpdatesMock.mockResolvedValue({ sent: 2, total: 2 });
    from.mockReturnValue(
      makeBuilder({
        maybeSingle: {
          data: {
            ...PRIOR_ROW,
            attendees: GUESTS,
            series_id: "s1",
            series_original_start: "2026-07-10T10:00:00.000Z",
          },
        },
      }),
    );

    await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({ series: { seriesId: "s1", originalStartIso: "2026-07-10T10:00:00.000Z" } }),
    );
  });

  it("stays quiet when an edit leaves the timing alone", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ title: "Quarterly review (final)", agenda: "1. Numbers" }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("treats a re-sent identical time as no change", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    // Same instant, different spelling — a save must not read as a reschedule.
    const res = await PATCH(req({ scheduledAt: "2026-07-10T06:00:00.000-04:00", durationMinutes: 60 }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("invites a newly added guest instead of mailing them a reschedule", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
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
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
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
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockImplementation(withDirectory({ ...PRIOR_ROW, attendees: [] }, []));

    const res = await PATCH(req({ attendees: [{ name: "Someone Outside", type: "external" }] }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ invited: 0, uninvited: 1 });
    expect(sendMeetingInvitesMock).not.toHaveBeenCalled();
  });

  it("tells attendees when the meeting moves rooms, without moving the time", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    sendMeetingUpdatesMock.mockResolvedValue({ sent: 2, total: 2 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ location: "Room 9" }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notified: 2 });
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "relocated",
      expect.objectContaining({
        emails: ["ada@lp.test", "ben@lp.test"],
        location: "Room 9",
        previousLocation: "Room 3",
      }),
    );
  });

  it("tells attendees when the join link is swapped", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    await PATCH(req({ meetingUrl: "https://meet.test/new" }), params);

    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "relocated",
      expect.objectContaining({ meetingUrl: "https://meet.test/new" }),
    );
  });

  it("sends one email, not two, when the meeting moves in time and place at once", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z", location: "Room 9" }), params);

    // The reschedule notice already carries the new place.
    expect(sendMeetingUpdatesMock).toHaveBeenCalledTimes(1);
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({ location: "Room 9" }),
    );
  });

  it("does not mail anyone when only the agenda changes", async () => {
    // Wording changes are read when the attendee opens the meeting. Mailing
    // them is how people learn to ignore these emails.
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    await PATCH(req({ agenda: "1. Numbers 2. Everything else" }), params);

    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("does not treat re-saving the same place as a move", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    await PATCH(req({ location: "  Room 3  ", meetingUrl: "" }), params);

    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("notifies at the sequence the save just bumped, not the one before it", async () => {
    // The trigger increments calendar_sequence on every update. A revision sent
    // at the pre-save value is one the client already holds, and it discards
    // it — which is exactly how a reschedule fails to move anyone's calendar.
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(
      makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS, calendar_sequence: 7 } } }),
    );

    await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z", attendees: [...GUESTS, NEW_GUEST] }), params);

    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({ sequence: 8 }),
    );
    // The late-guest invitation carries the same bumped revision.
    expect(sendMeetingInvitesMock).toHaveBeenCalledWith(expect.objectContaining({ sequence: 8 }));
  });

  it("falls back to the stored sequence when the save reports none", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: null });
    from.mockReturnValue(
      makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS, calendar_sequence: 7 } } }),
    );

    await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "rescheduled",
      expect.objectContaining({ sequence: 7 }),
    );
  });

  it("cancels at the sequence the soft delete bumped", async () => {
    // deleteMeetingLocal is an UPDATE, so the trigger fires there too. A CANCEL
    // at a sequence the client already holds leaves the meeting in place.
    deleteMeetingLocalMock.mockResolvedValue({ ok: true, calendarSequence: 9 });
    from.mockReturnValue(
      makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS, calendar_sequence: 8 } } }),
    );

    await DELETE(new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE" }), params);

    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "cancelled",
      expect.objectContaining({ sequence: 9 }),
    );
  });

  it("rejects a malformed attendee list instead of crashing on it", async () => {
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW } }));
    const res = await PATCH(req({ attendees: [null] }), params);
    expect(res.status).toBe(422);
    expect(updateMeetingMock).not.toHaveBeenCalled();
  });

  it("tells a dropped guest they are off the meeting", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, attendees: GUESTS } } }));

    const res = await PATCH(req({ attendees: [GUESTS[0]] }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).toHaveBeenCalledWith(
      "removed",
      expect.objectContaining({ emails: ["ben@lp.test"] }),
    );
  });

  it("leaves draft meetings unnotified", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...PRIOR_ROW, is_draft: true, attendees: GUESTS } } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-11T15:00:00.000Z" }), params);

    expect(res.status).toBe(200);
    expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
  });

  it("moves a link booking with the meeting and mails the invitee once", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 8 });
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
    deleteMeetingLocalMock.mockResolvedValue({ ok: true, calendarSequence: 9 });
    const res = await DELETE(new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE" }), params);

    expect(res.status).toBe(200);
    expect(deleteMeetingLocalMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
    );
  });

  it("tells the guests when a meeting is cancelled", async () => {
    deleteMeetingLocalMock.mockResolvedValue({ ok: true, calendarSequence: 9 });
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
    deleteMeetingLocalMock.mockResolvedValue({ ok: true, calendarSequence: 9 });
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

  describe("cancelling this and following meetings of a series", () => {
    // Five weekly meetings; the third is the one opened.
    const SERIES = [0, 1, 2, 3, 4].map((i) => ({
      id: i === 2 ? "m1" : `s${i}`,
      series_index: i,
      series_rule: "FREQ=WEEKLY;COUNT=5",
      series_original_start: `2026-10-${String(6 + 7 * i).padStart(2, "0")}T15:00:00.000Z`,
      scheduled_at: `2026-10-${String(6 + 7 * i).padStart(2, "0")}T15:00:00.000Z`,
      duration_minutes: 30,
      calendar_sequence: 1,
      deleted_at: null as string | null,
    }));
    const SERIES_PRIOR = {
      ...PRIOR_ROW,
      attendees: GUESTS,
      title: "Weekly sync",
      timezone: "America/Chicago",
      series_id: "s0",
      series_index: 2,
      series_original_start: SERIES[2].series_original_start,
    };
    function del(body: unknown) {
      return DELETE(
        new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE", body: JSON.stringify(body) }),
        params,
      );
    }

    beforeEach(() => {
      from.mockReturnValue(makeBuilder({ maybeSingle: { data: SERIES_PRIOR } }));
      loadSeriesRowsMock.mockResolvedValue(SERIES);
      deleteMeetingLocalMock.mockResolvedValue({ ok: true, calendarSequence: 2 });
      setSeriesRuleMock.mockResolvedValue(3);
      sendSeriesEndedMock.mockResolvedValue({ sent: 2, total: 2 });
    });

    it("cancels this meeting and every later one, and keeps the earlier ones", async () => {
      const res = await del({ scope: "following" });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ cancelled: 3, notified: 2 });
      expect(deleteMeetingLocalMock.mock.calls.map((c) => c[2])).toEqual(["m1", "s3", "s4"]);
      expect(setSeriesRuleMock).toHaveBeenCalledWith(expect.anything(), "org1", ["s0", "s1"], "FREQ=WEEKLY;COUNT=2");
    });

    it("tells guests once, about the series, instead of once per meeting", async () => {
      await del({ scope: "following", reason: "Fund closed" });
      expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
      expect(sendSeriesEndedMock).toHaveBeenCalledTimes(1);
      expect(sendSeriesEndedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          seriesId: "s0",
          emails: ["ada@lp.test", "ben@lp.test"],
          keepRrule: "FREQ=WEEKLY;COUNT=2",
          firstStartIso: SERIES[0].series_original_start,
          fromStartIso: SERIES[2].series_original_start,
          timezone: "America/Chicago",
          cancelled: 3,
          reason: "Fund closed",
          // Above the sequence the remaining meetings were bumped to.
          sequence: 4,
        }),
      );
    });

    it("cancels the whole series from its first meeting", async () => {
      from.mockReturnValue(makeBuilder({ maybeSingle: { data: { ...SERIES_PRIOR, series_index: 0 } } }));
      const res = await del({ scope: "following" });
      expect(await res.json()).toMatchObject({ cancelled: 5 });
      expect(setSeriesRuleMock).not.toHaveBeenCalled();
      expect(sendSeriesEndedMock).toHaveBeenCalledWith(expect.objectContaining({ keepRrule: null, cancelled: 5 }));
    });

    it("skips meetings of the series that were already cancelled", async () => {
      loadSeriesRowsMock.mockResolvedValue(SERIES.map((r) => (r.series_index === 3 ? { ...r, deleted_at: "2026-09-01T00:00:00Z" } : r)));
      const res = await del({ scope: "following" });
      expect(await res.json()).toMatchObject({ cancelled: 2 });
      expect(deleteMeetingLocalMock.mock.calls.map((c) => c[2])).toEqual(["m1", "s4"]);
    });

    it("cancels only the one meeting without the scope", async () => {
      await del({});
      expect(loadSeriesRowsMock).not.toHaveBeenCalled();
      expect(deleteMeetingLocalMock).toHaveBeenCalledTimes(1);
      expect(sendSeriesEndedMock).not.toHaveBeenCalled();
    });

    it("treats the scope as one meeting for a meeting that does not repeat", async () => {
      from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW } }));
      await del({ scope: "following" });
      expect(loadSeriesRowsMock).not.toHaveBeenCalled();
      expect(deleteMeetingLocalMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("editing this and following meetings of a series", () => {
    // Five weekly meetings, Tuesdays 10:00 Chicago; the third is the one opened.
    const SLOT = (i: number) => new Date(Date.UTC(2026, 9, 6 + 7 * i, 15)).toISOString();
    const SERIES = [0, 1, 2, 3, 4].map((i) => ({
      id: i === 2 ? "m1" : `s${i}`,
      series_index: i,
      series_rule: "FREQ=WEEKLY;COUNT=5",
      series_original_start: SLOT(i),
      scheduled_at: SLOT(i),
      duration_minutes: 30,
      calendar_sequence: 1,
      deleted_at: null as string | null,
    }));
    const SERIES_PRIOR = {
      ...PRIOR_ROW,
      attendees: GUESTS,
      title: "Weekly sync",
      timezone: "America/Chicago",
      scheduled_at: SLOT(2),
      duration_minutes: 30,
      series_id: "s0",
      series_index: 2,
      series_original_start: SLOT(2),
    };
    // Week three moved to 11:00, every later week with it.
    const ELEVEN = new Date(Date.UTC(2026, 9, 20, 16)).toISOString();

    beforeEach(() => {
      from.mockReturnValue(makeBuilder({ maybeSingle: { data: SERIES_PRIOR } }));
      loadSeriesRowsMock.mockResolvedValue(SERIES);
      updateMeetingMock.mockResolvedValue({ ok: true, calendarSequence: 2 });
      setSeriesRuleMock.mockResolvedValue(2);
      sendSeriesEndedMock.mockResolvedValue({ sent: 2, total: 2 });
      sendMeetingInvitesMock.mockResolvedValue({ sent: 2, total: 2, attempted: 2, failed: [], reasons: [] });
    });

    it("moves this meeting and every later one, and leaves the earlier ones", async () => {
      const res = await PATCH(req({ scope: "following", scheduledAt: ELEVEN, durationMinutes: 30 }), params);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ seriesUpdated: 3 });
      expect(updateMeetingMock.mock.calls.map((c) => [c[2], c[3].scheduledAt])).toEqual([
        ["m1", new Date(Date.UTC(2026, 9, 20, 16)).toISOString()],
        ["s3", new Date(Date.UTC(2026, 9, 27, 16)).toISOString()],
        // After the clock change: still 11:00 in Chicago.
        ["s4", new Date(Date.UTC(2026, 10, 3, 17)).toISOString()],
      ]);
    });

    it("splits the series: the rest becomes its own, with this meeting first", async () => {
      await PATCH(req({ scope: "following", scheduledAt: ELEVEN }), params);
      expect(markSeriesOccurrenceMock.mock.calls.map((c) => [c[1], c[2].seriesId, c[2].index, c[2].rule])).toEqual([
        ["m1", "m1", 0, "FREQ=WEEKLY;COUNT=3"],
        ["s3", "m1", 1, "FREQ=WEEKLY;COUNT=3"],
        ["s4", "m1", 2, "FREQ=WEEKLY;COUNT=3"],
      ]);
      expect(setSeriesRuleMock).toHaveBeenCalledWith(expect.anything(), "org1", ["s0", "s1"], "FREQ=WEEKLY;COUNT=2");
    });

    it("tells guests the old series now ends, and invites them to the new one", async () => {
      await PATCH(req({ scope: "following", scheduledAt: ELEVEN }), params);
      expect(sendSeriesEndedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "changed",
          seriesId: "s0",
          keepRrule: "FREQ=WEEKLY;COUNT=2",
          emails: ["ada@lp.test", "ben@lp.test"],
        }),
      );
      expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: ["ada@lp.test", "ben@lp.test"],
          startIso: ELEVEN,
          series: { seriesId: "m1", rrule: "FREQ=WEEKLY;COUNT=3", timezone: "America/Chicago" },
        }),
      );
      // Not one reschedule notice per meeting.
      expect(sendMeetingUpdatesMock).not.toHaveBeenCalled();
    });

    it("re-issues the same series from its first meeting, with no split", async () => {
      from.mockReturnValue(
        makeBuilder({ maybeSingle: { data: { ...SERIES_PRIOR, series_index: 0, scheduled_at: SLOT(0), series_original_start: SLOT(0) } } }),
      );
      const res = await PATCH(
        new NextRequest("http://localhost/api/meetings/s0", {
          method: "PATCH",
          body: JSON.stringify({ scope: "following", title: "Weekly LP sync" }),
        }),
        { params: Promise.resolve({ id: "s0" }) },
      );
      expect(await res.json()).toMatchObject({ seriesUpdated: 5 });
      expect(setSeriesRuleMock).not.toHaveBeenCalled();
      expect(sendSeriesEndedMock).not.toHaveBeenCalled();
      expect(sendMeetingInvitesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Weekly LP sync",
          series: { seriesId: "s0", rrule: "FREQ=WEEKLY;COUNT=5", timezone: "America/Chicago" },
          // Above every sequence the series has carried.
          sequence: 3,
        }),
      );
    });

    it("refuses the whole change when a later meeting would land on busy time", async () => {
      loadSeriesExternalConflictsMock.mockResolvedValueOnce([
        { start: "2026-10-27T16:00:00.000Z", end: "2026-10-27T17:00:00.000Z" },
      ]);
      const res = await PATCH(req({ scope: "following", scheduledAt: ELEVEN }), params);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ overridable: false });
      expect(updateMeetingMock).not.toHaveBeenCalled();
    });

    it("drops a guest from the rest of the series and tells them so", async () => {
      await PATCH(req({ scope: "following", attendees: [GUESTS[0]] }), params);
      expect(sendSeriesEndedMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "removed", emails: ["ben@lp.test"] }),
      );
      expect(sendMeetingInvitesMock).toHaveBeenCalledWith(expect.objectContaining({ emails: ["ada@lp.test"] }));
    });

    it("edits only the one meeting without the scope", async () => {
      await PATCH(req({ scheduledAt: ELEVEN }), params);
      expect(loadSeriesRowsMock).not.toHaveBeenCalled();
      expect(updateMeetingMock).toHaveBeenCalledTimes(1);
    });
  });
});
