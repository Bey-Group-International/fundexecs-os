import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildMeetingInviteUrl, buildMeetingRoomUrl, saveScheduledMeeting, syncMeetingExternal } from "@/lib/meetings/service";
import { parseAttendeeInput, type MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import { SITE_URL } from "@/lib/site";
import {
  validateMeetingDraft,
  localToIso,
  durationMinutesFromTimes,
  findConflicts,
  type ConflictCandidate,
} from "@/lib/meetings/schedule";

export const runtime = "nodejs";

interface ScheduleBody {
  meetingId?: string;
  draft?: boolean;
  allowConflict?: boolean;
  title?: string;
  meetingType?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  objective?: string;
  agenda?: string;
  preparationRequirements?: string;
  attendees?: MeetingAttendeeInput[] | string;
  attachments?: Array<{ name: string; url?: string | null }>;
  assignedCopilotAgent?: string;
  relatedRecordType?: string;
  relatedRecordId?: string;
  dealId?: string;
  calendarVisibility?: string;
  reminderMinutes?: number;
  priority?: "low" | "normal" | "high" | "critical";
  tags?: string[];
  externalCalendarSyncEnabled?: boolean;
  externalCalendarProvider?: string;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as ScheduleBody;
    const isDraft = body.draft === true;

    // Drafts can be partial; a real save must pass field-level validation.
    const errors = validateMeetingDraft({
      title: body.title,
      meetingType: body.meetingType,
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      timezone: body.timezone,
    });
    if (!isDraft && Object.keys(errors).length > 0) {
      return NextResponse.json({ error: "Missing required meeting details.", fieldErrors: errors }, { status: 422 });
    }

    const timezone = body.timezone?.trim() || "UTC";
    const date = body.date || new Date().toISOString().slice(0, 10);
    const startTime = body.startTime || "09:00";
    const endTime = body.endTime || "10:00";
    const scheduledAt = localToIso(date, startTime, timezone);
    // Clamp to the same [15, 480] range the persistence layer (cleanDuration)
    // enforces, so conflict detection runs against the exact window that gets
    // stored — otherwise the 409 check and the saved row could disagree.
    const durationMinutes = Math.min(480, Math.max(15, durationMinutesFromTimes(startTime, endTime) || 60));
    const endIso = new Date(new Date(scheduledAt).getTime() + durationMinutes * 60_000).toISOString();

    const attendees = Array.isArray(body.attendees)
      ? body.attendees
      : typeof body.attendees === "string"
        ? parseAttendeeInput(body.attendees)
        : [];

    const supabase = await createServerClient();

    // Conflict detection against the internal calendar. Warn (409) unless the
    // user explicitly chose to save anyway. Drafts never block on conflicts. The
    // conflict is scoped to a shared person (host or attendee), so unrelated
    // meetings in the org don't false-alarm.
    let conflicts: ReturnType<typeof findConflicts> = [];
    if (!isDraft) {
      // A candidate can only overlap [scheduledAt, endIso) if it starts within a
      // max-meeting-length window before the end — bound the fetch accordingly
      // (durations are capped at 480 min) instead of scanning all future rows.
      const windowStart = new Date(new Date(scheduledAt).getTime() - 8 * 3600_000).toISOString();
      const { data: existing } = await supabase
        .from("live_meetings")
        .select("id, title, scheduled_at, duration_minutes, host_id, attendees")
        .eq("organization_id", auth.ctx.orgId)
        .is("deleted_at", null)
        .eq("is_draft", false)
        .neq("status", "ended")
        .gte("scheduled_at", windowStart)
        .lt("scheduled_at", endIso)
        .limit(200);
      conflicts = findConflicts((existing ?? []) as ConflictCandidate[], scheduledAt, endIso, {
        excludeId: body.meetingId ?? null,
        subjectHostId: auth.ctx.userId,
        subjectEmails: [auth.ctx.email, ...guestEmails(attendees)],
      });
      if (conflicts.length > 0 && body.allowConflict !== true) {
        return NextResponse.json({ error: "Time conflicts with another meeting.", conflicts }, { status: 409 });
      }
    }

    const saved = await saveScheduledMeeting(supabase, {
      meetingId: body.meetingId ?? null,
      orgId: auth.ctx.orgId,
      hostId: auth.ctx.userId,
      draft: isDraft,
      title: body.title ?? "Meeting",
      meetingType: body.meetingType ?? "internal_strategy",
      scheduledAt,
      durationMinutes,
      timezone,
      description: body.description ?? null,
      location: body.location ?? null,
      meetingUrl: body.meetingUrl ?? null,
      objective: body.objective ?? null,
      agenda: body.agenda ?? null,
      preparationRequirements: body.preparationRequirements ?? null,
      attendees,
      attachments: body.attachments ?? [],
      assignedCopilotAgent: body.assignedCopilotAgent ?? null,
      relatedRecordType: body.relatedRecordType ?? null,
      relatedRecordId: body.relatedRecordId ?? null,
      dealId: body.dealId ?? null,
      calendarVisibility: body.calendarVisibility ?? "organization",
      reminderMinutes: body.reminderMinutes ?? null,
      priority: body.priority ?? "normal",
      tags: body.tags ?? [],
      externalCalendarSyncEnabled: body.externalCalendarSyncEnabled ?? false,
      externalCalendarProvider: body.externalCalendarProvider ?? null,
    });

    // Third-party sync happens only after the native meeting is saved, and its
    // failure must not break meeting creation.
    let externalSyncError: string | undefined;
    if (!saved.isDraft && body.externalCalendarSyncEnabled && body.externalCalendarProvider) {
      try {
        const result = await syncMeetingExternal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, saved.id);
        if (!result.ok) externalSyncError = result.error;
        saved.externalCalendarSyncStatus = result.status;
      } catch (err) {
        externalSyncError = err instanceof Error ? err.message : "External sync failed";
      }
    }

    // Email guest invites once the meeting is a real (non-draft) saved meeting.
    // Non-fatal: a missing provider or send failure never blocks the meeting.
    let invited = 0;
    if (!saved.isDraft) {
      const emails = guestEmails(attendees);
      if (emails.length > 0) {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const result = await sendMeetingInvites({
            // Canonical app URL so the emailed link is correct regardless of
            // which host/proxy served this request.
            origin: SITE_URL,
            roomCode: saved.roomCode,
            title: body.title ?? "Meeting",
            senderName: userData.user?.email ?? "Someone",
            emails,
          });
          invited = result.sent;
        } catch (err) {
          console.error("[/api/meetings/schedule] invite send failed", err);
        }
      }
    }

    return NextResponse.json({
      id: saved.id,
      roomCode: saved.roomCode,
      scheduledAt: saved.scheduledAt,
      durationMinutes: saved.durationMinutes,
      isDraft: saved.isDraft,
      lockedAt: saved.lockedAt,
      internalCalendarEventId: saved.internalCalendarEventId,
      externalCalendarSyncStatus: saved.externalCalendarSyncStatus,
      externalSyncError,
      invited,
      conflicts,
      roomUrl: buildMeetingRoomUrl(SITE_URL, saved.roomCode),
      inviteUrl: buildMeetingInviteUrl(SITE_URL, saved.roomCode),
    });
  } catch (err) {
    console.error("[/api/meetings/schedule]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to schedule meeting" },
      { status: 500 },
    );
  }
}
