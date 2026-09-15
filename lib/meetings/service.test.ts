const writeDashboardAuditMock = jest.fn();
jest.mock("@/lib/dashboard/audit", () => ({
  writeDashboardAudit: (...args: unknown[]) => writeDashboardAuditMock(...args),
}));

import {
  buildMeetingInviteUrl,
  buildMeetingRoomUrl,
  createMeeting,
  generateRoomCode,
  persistInstitutionalMeetingRecord,
  updateMeeting,
} from "./service";

describe("meeting service", () => {
  it("generates readable room codes and native URLs", () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{2}$/);
    expect(buildMeetingInviteUrl("https://app.test/", code)).toBe(`https://app.test/meeting-invite/${code}`);
    expect(buildMeetingRoomUrl("https://app.test/", code)).toBe(`https://app.test/meetings/${code}`);
  });

  it("upserts a scheduled native meeting", async () => {
    const upsert = jest.fn(() => builder);
    const builder: Record<string, unknown> = {
      upsert,
      select: () => builder,
      single: async () => ({
        data: {
          id: "m1",
          room_code: "abc-def-12",
          host_id: "u1",
          scheduled_at: "2026-07-05T10:00:00.000Z",
          duration_minutes: 45,
        },
        error: null,
      }),
    };
    const supabase = { from: jest.fn(() => builder) } as any;

    const meeting = await createMeeting(supabase, {
      title: "Investor meeting",
      orgId: "org1",
      hostId: "u1",
      scheduledAt: "2026-07-05T10:00:00.000Z",
      durationMinutes: 45,
      timezone: "America/New_York",
      meetingType: "investor_meeting",
    });

    expect(meeting).toEqual({
      id: "m1",
      roomCode: "abc-def-12",
      hostId: "u1",
      scheduledAt: "2026-07-05T10:00:00.000Z",
      durationMinutes: 45,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Investor meeting",
        organization_id: "org1",
        scheduled_at: "2026-07-05T10:00:00.000Z",
        preparation_status: "prep_needed",
      }),
      expect.any(Object),
    );
  });

  it("archives meeting reports into meeting_notes and notes_snapshot", async () => {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    const supabase = {
      from: (table: string) => ({
        insert: (values: unknown) => {
          inserts.push({ table, values });
          return Promise.resolve({ error: null });
        },
        update: (values: unknown) => {
          updates.push({ table, values });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      }),
    } as any;

    await persistInstitutionalMeetingRecord(supabase, {
      meeting: { id: "m1", organization_id: "org1", deal_id: "d1", title: "Diligence call" },
      actorId: "u1",
      participants: ["A", "B"],
      transcript: "A: hello",
      analysis: {
        summary: "Discussed diligence.",
        key_points: ["Pipeline"],
        action_items: ["A: Send deck"],
        decisions: ["Proceed"],
        follow_up_draft: "Thanks",
      },
    });

    expect(inserts).toEqual([
      {
        table: "meeting_notes",
        values: expect.objectContaining({
          organization_id: "org1",
          deal_id: "d1",
          title: "Diligence call",
          participants: ["A", "B"],
          transcript: "A: hello",
          created_by: "u1",
        }),
      },
    ]);
    expect(updates).toEqual([
      {
        table: "live_meetings",
        values: expect.objectContaining({
          followup_status: "draft",
          notes_snapshot: expect.objectContaining({ summary: "Discussed diligence." }),
        }),
      },
    ]);
  });

  /** A client that records what it was asked to insert. */
  function recordingClient(inserts: Record<string, unknown>[]) {
    return {
      from: () => ({
        insert: (values: Record<string, unknown>) => {
          inserts.push(values);
          return Promise.resolve({ error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    } as never;
  }

  const RECORD = {
    meeting: { id: "m1", organization_id: "org1", deal_id: null, title: "Diligence call" },
    actorId: "u1",
    transcript: "A: hello",
    analysis: { summary: "s", key_points: [], action_items: [], decisions: [], follow_up_draft: "" },
  };

  it("dates the record to when the meeting happened", async () => {
    // Not to when the report ran. Those are moments apart as a meeting ends
    // and a day apart whenever a host ends one the next morning.
    const inserts: Record<string, unknown>[] = [];
    await persistInstitutionalMeetingRecord(recordingClient(inserts), {
      ...RECORD,
      occurredAt: "2026-07-05T10:00:00.000Z",
    });
    expect(inserts[0].occurred_at).toBe("2026-07-05T10:00:00.000Z");
  });

  it("falls back to now when the meeting has no time on it", async () => {
    const inserts: Record<string, unknown>[] = [];
    await persistInstitutionalMeetingRecord(recordingClient(inserts), { ...RECORD, occurredAt: null });
    expect(typeof inserts[0].occurred_at).toBe("string");
    expect(isNaN(new Date(inserts[0].occurred_at as string).getTime())).toBe(false);
  });

  it("does not file a record dated to nonsense", async () => {
    const inserts: Record<string, unknown>[] = [];
    await persistInstitutionalMeetingRecord(recordingClient(inserts), { ...RECORD, occurredAt: "soon" });
    expect(isNaN(new Date(inserts[0].occurred_at as string).getTime())).toBe(false);
  });

  // The record of the meeting. A write that fails in silence is
  // indistinguishable from a meeting that produced nothing, and the first
  // anyone knows is a search that comes back empty months later.
  it("says so when the record could not be written", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const supabase = {
      from: () => ({
        insert: () => Promise.resolve({ error: { message: "permission denied" } }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    } as never;
    await persistInstitutionalMeetingRecord(supabase, RECORD);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("meeting_notes not written"),
      "permission denied",
    );
    spy.mockRestore();
  });
});

describe("updateMeeting — the calendar sequence and the reminder stamp", () => {
  const PRIOR = {
    id: "m1",
    scheduled_at: "2026-09-10T15:00:00.000Z",
    reminder_minutes: 15,
    locked_at: "2026-09-01T00:00:00.000Z",
    external_calendar_sync_enabled: false,
    external_calendar_provider: null,
    external_calendar_sync_status: "not_connected",
    calendar_sequence: 7,
  };

  /** Captures the update payload and hands back the post-write row. */
  function client(saved: { calendar_sequence: number | null } | null = { calendar_sequence: 8 }) {
    const update = jest.fn();
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: PRIOR, error: null }),
      update: (values: unknown) => {
        update(values);
        return {
          eq: () => ({
            eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) }),
          }),
        };
      },
    };
    return { supabase: { from: () => builder } as never, update };
  }

  beforeEach(() => jest.clearAllMocks());

  it("returns the sequence the trigger bumped, not the one it read", async () => {
    const { supabase } = client({ calendar_sequence: 8 });
    const result = await updateMeeting(supabase, { orgId: "org1", userId: "u1" }, "m1", { title: "New" });
    expect(result).toEqual({ ok: true, calendarSequence: 8 });
  });

  it("clears the reminder stamp when the meeting moves", async () => {
    // A reminder already sent describes the OLD time; leaving the stamp is what
    // stops the sweep ever reminding anybody about the new one.
    const { supabase, update } = client();
    await updateMeeting(supabase, { orgId: "org1", userId: "u1" }, "m1", {
      scheduledAt: "2026-09-11T15:00:00.000Z",
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ last_reminder_sent_at: null }));
  });

  it("clears it when the reminder setting itself changes", async () => {
    const { supabase, update } = client();
    await updateMeeting(supabase, { orgId: "org1", userId: "u1" }, "m1", { reminderMinutes: 60 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ last_reminder_sent_at: null }));
  });

  it("leaves it alone when nothing about the timing actually changed", async () => {
    // Re-saving the same instant, spelled differently, is not a move — and an
    // attendee edit is not one either. Resetting on those would re-mail a
    // reminder to everybody because one guest was added.
    for (const input of [
      { scheduledAt: "2026-09-10T15:00:00.000Z" },
      { title: "Renamed" },
      { attendees: [{ name: "Ada", email: "ada@lp.test" }] },
      { reminderMinutes: 15 },
    ]) {
      const { supabase, update } = client();
      await updateMeeting(supabase, { orgId: "org1", userId: "u1" }, "m1", input);
      expect(update).toHaveBeenCalledWith(
        expect.not.objectContaining({ last_reminder_sent_at: null }),
      );
    }
  });
});
