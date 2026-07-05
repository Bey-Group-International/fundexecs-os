import {
  buildMeetingInviteUrl,
  buildMeetingRoomUrl,
  createMeeting,
  generateRoomCode,
  persistInstitutionalMeetingRecord,
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
});
