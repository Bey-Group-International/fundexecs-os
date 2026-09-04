import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { formatSlotFull } from "@/lib/meetings/scheduling";
import { requireOrgContext } from "@/lib/auth";
import { buildMeetingInviteUrl, buildMeetingRoomUrl, saveScheduledMeeting, syncMeetingExternal } from "@/lib/meetings/service";
import { normalizeAttendees, parseAttendeeInput, type MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { needsDirectory, resolveAttendeeDirectory } from "@/lib/meetings/directory";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import { loadBlockConflicts } from "@/lib/meetings/blocks.server";
import { conflictMessage } from "@/lib/meetings/schedule";
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

    // The body is untrusted: an array element that is not an attendee reaches
    // code that reads fields off it, so it is rejected as a bad request rather
    // than thrown on as a 500.
    const typedAttendees = Array.isArray(body.attendees)
      ? normalizeAttendees(body.attendees)
      : typeof body.attendees === "string"
        ? parseAttendeeInput(body.attendees)
        : [];
    if (typedAttendees === null) {
      return NextResponse.json(
        { error: "Check the attendee list.", fieldErrors: { attendees: "Each attendee needs a name or an email address." } },
        { status: 422 },
      );
    }

    const supabase = await createServerClient();

    // An attendee entered by name alone carries no address, and an attendee
    // with no address is one nobody emails. Look the name up in the
    // organization's own member directory first, so scheduling a meeting with
    // a teammate actually reaches them. Whoever is left is counted back to the
    // host rather than quietly dropped.
    let attendees = typedAttendees;
    let uninvited = 0;
    if (needsDirectory(typedAttendees)) {
      const resolution = resolveAttendeeDirectory(
        typedAttendees,
        await loadOrgDirectory(supabase, auth.ctx.orgId),
      );
      attendees = resolution.attendees;
      uninvited = resolution.unreachable.length;
    }

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
      // Time the host blocked by hand warns like an overlapping meeting does —
      // same "Save anyway" escape, since a block is the host's own note to
      // themselves rather than a commitment to someone else.
      const blockedBy = await loadBlockConflicts(supabase, auth.ctx.userId, scheduledAt, endIso);
      if ((conflicts.length > 0 || blockedBy.length > 0) && body.allowConflict !== true) {
        return NextResponse.json(
          { error: conflictMessage(conflicts.length, blockedBy.length), conflicts, blockedBy },
          { status: 409 },
        );
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
    // Non-fatal: an unconnected mailbox or send failure never blocks the meeting.
    // The host is emailed too, and both sides get a real calendar invitation —
    // so this runs even with no guests, because the host's own confirmation is
    // what puts the meeting in their calendar.
    let invited = 0;
    // Whether anything CAN be emailed, resolved once. Without a mailbox the
    // send degrades silently to nothing, and a host who is told "invited 0"
    // reads that as "nobody had an address" rather than "your org cannot send".
    let mailboxConnected = true;
    let mailboxProblem: string | null = null;
    if (!saved.isDraft) {
      const emails = guestEmails(attendees);
      {
        try {
          const { data: userData } = await supabase.auth.getUser();
          // The scheduling member's own mailbox. Non-blocking: the meeting is
          // already created by this point and must not be lost to a missing
          // connection.
          const mailbox = await mailboxFor(supabase, auth.ctx.userId, auth.ctx.orgId);
          mailboxConnected = mailbox.ok;
          mailboxProblem = mailbox.ok ? null : mailboxProblemMessage(mailbox.problem);
          const result = await sendMeetingInvites({
            credentials: mailbox.ok ? { gmailAccessToken: mailbox.token } : undefined,
            orgId: auth.ctx.orgId,
            // Canonical app URL so the emailed link is correct regardless of
            // which host/proxy served this request.
            origin: SITE_URL,
            roomCode: saved.roomCode,
            title: body.title ?? "Meeting",
            senderName: userData.user?.email ?? "Someone",
            emails,
            hostEmail: auth.ctx.email ?? userData.user?.email ?? null,
            // Identity of the calendar entry, so the reschedule and cancel
            // paths move this one rather than adding a second.
            meetingId: saved.id,
            startIso: saved.scheduledAt,
            durationMinutes: saved.durationMinutes,
            // A meeting that was just created has never been updated, so its
            // trigger-maintained sequence is still zero.
            sequence: 0,
            whenLabel: saved.scheduledAt ? formatSlotFull(saved.scheduledAt, timezone) : null,
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
      uninvited,
      mailboxConnected,
      mailboxProblem,
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
