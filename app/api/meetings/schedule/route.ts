import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { formatSlotFull } from "@/lib/meetings/scheduling";
import { requireOrgContext } from "@/lib/auth";
import { buildMeetingInviteUrl, buildMeetingRoomUrl, markSeriesOccurrence, saveScheduledMeeting, syncMeetingExternal } from "@/lib/meetings/service";
import { normalizeAttendees, parseAttendeeInput, type MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { needsDirectory, resolveAttendeeDirectory } from "@/lib/meetings/directory";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import { planCalendarSync } from "@/lib/meetings/calendar-sync";
import { canWriteCalendar } from "@/lib/calendar/google-write.server";
import { loadBlockConflicts } from "@/lib/meetings/blocks.server";
import { loadSeriesExternalConflicts } from "@/lib/meetings/conflicts.server";
import { describeRepeat, occurrenceDates, parseRepeat, seriesRrule } from "@/lib/meetings/recurrence";
import { BUSY_ELSEWHERE_MESSAGE, conflictGate, conflictMessage } from "@/lib/meetings/schedule";
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
  guestQuickAccess?: boolean;
  externalCalendarProvider?: string;
  /** Repeat the meeting: { freq: "weekly" | "monthly", count }. */
  repeat?: unknown;
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

    // A repeating meeting is decided here, once, and every later step works
    // from the same list of starts. Drafts do not repeat: a series is created
    // when it is scheduled.
    const repeat = isDraft ? null : parseRepeat(body.repeat);
    if (repeat && "error" in repeat) {
      return NextResponse.json({ error: repeat.error, fieldErrors: { repeat: repeat.error } }, { status: 422 });
    }
    const occurrenceStarts = repeat
      ? occurrenceDates(date, repeat).map((d) => localToIso(d, startTime, timezone))
      : [scheduledAt];

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
      // All three checks at once — they are independent, and asking them one
      // after another put two extra round trips in front of every save.
      //
      // Time the host blocked by hand warns like an overlapping meeting does —
      // same "Save anyway" escape, since a block is the host's own note to
      // themselves rather than a commitment to someone else. So does time
      // already taken in a calendar they only connected: the commitment is
      // just as real for being kept somewhere else.
      const [{ data: existing }, blockedBy, busyElsewhere] = await Promise.all([
        supabase
          .from("live_meetings")
          .select("id, title, scheduled_at, duration_minutes, host_id, attendees")
          .eq("organization_id", auth.ctx.orgId)
          .is("deleted_at", null)
          .eq("is_draft", false)
          .neq("status", "ended")
          .gte("scheduled_at", windowStart)
          .lt("scheduled_at", endIso)
          .limit(200),
        loadBlockConflicts(supabase, auth.ctx.userId, scheduledAt, endIso),
        // Every meeting of a series, not just the first: a clash in week five
        // is as real as one today, and the series is refused as a whole.
        loadSeriesExternalConflicts(supabase, {
          userId: auth.ctx.userId,
          starts: occurrenceStarts,
          durationMinutes,
          timezone,
        }),
      ]);
      conflicts = findConflicts((existing ?? []) as ConflictCandidate[], scheduledAt, endIso, {
        excludeId: body.meetingId ?? null,
        subjectHostId: auth.ctx.userId,
        subjectEmails: [auth.ctx.email, ...guestEmails(attendees)],
      });
      // Time taken in a connected calendar cannot be saved over, "Save anyway"
      // or not; the rest of the clash can.
      const gate = conflictGate(
        { meetings: conflicts.length, blocks: blockedBy.length, external: busyElsewhere.length },
        body.allowConflict === true,
      );
      if (gate !== "ok") {
        return NextResponse.json(
          {
            error:
              gate === "blocked"
                ? BUSY_ELSEWHERE_MESSAGE
                : conflictMessage(conflicts.length, blockedBy.length, busyElsewhere.length),
            overridable: gate === "overridable",
            conflicts,
            blockedBy,
            busyElsewhere,
          },
          { status: 409 },
        );
      }
    }

    // Whether this meeting goes on the host's own calendar — decided here, from
    // the connection, rather than taken from the request.
    //
    // It used to require the client to send `externalCalendarSyncEnabled` AND
    // `externalCalendarProvider`, both of which came from a checkbox and a
    // dropdown inside a collapsed "Advanced options" section that defaults to
    // off. So the ordinary way of scheduling a meeting never attempted a push at
    // all, and a host with a working Google connection never saw a meeting
    // arrive. `canWriteCalendar` answers the only question that matters: is there
    // a calendar this member can actually write to — read access 403s on a write,
    // so it does not count. It never throws, because a calendar lookup must not
    // cost the host their meeting, and it answers null rather than false when it
    // could not find out, so the reason given below is not invented.
    const calendarConnected = await canWriteCalendar(supabase, auth.ctx.userId);
    const calendarPlan = planCalendarSync({
      connected: calendarConnected,
      requested: typeof body.externalCalendarSyncEnabled === "boolean" ? body.externalCalendarSyncEnabled : undefined,
      isDraft,
    });

    const meetingInput = {
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
      externalCalendarSyncEnabled: calendarPlan.enabled,
      // Coerced, not passed through: this decides whether a stranger with the
      // link walks straight into the room, so a truthy string must not enable it.
      guestQuickAccess: body.guestQuickAccess === true,
      // Derived, never taken from the request. The form used to offer Outlook,
      // Calendly and iCal, none of which has a writer — so a meeting could be
      // stored as syncing to Outlook and then pushed to Google or skipped.
      externalCalendarProvider: calendarPlan.provider,
    };
    const saved = await saveScheduledMeeting(supabase, meetingInput);

    // The rest of a series: its own meetings, each a copy of the first at its
    // own start, all pointing back at the first as the series. They are
    // marked before anything is pushed to Google, because a series meeting is
    // pushed without its guests (they get the series invitation instead).
    const seriesIds: string[] = [saved.id];
    if (repeat && !saved.isDraft) {
      const rule = seriesRrule(repeat);
      await markSeriesOccurrence(supabase, saved.id, { seriesId: saved.id, index: 0, rule, start: occurrenceStarts[0] });
      for (let i = 1; i < occurrenceStarts.length; i += 1) {
        const next = await saveScheduledMeeting(supabase, {
          ...meetingInput,
          meetingId: null,
          scheduledAt: occurrenceStarts[i],
        });
        await markSeriesOccurrence(supabase, next.id, { seriesId: saved.id, index: i, rule, start: occurrenceStarts[i] });
        seriesIds.push(next.id);
      }
    }

    // Third-party sync happens only after the native meeting is saved, and its
    // failure must not break meeting creation.
    let externalSyncError: string | undefined;
    // Not an error: a meeting that cannot reach a calendar nobody connected is
    // working correctly, and reporting it as a failure would send the host
    // looking for a fault. It is still worth saying, because the absence is
    // exactly what they are asking about.
    const calendarNote = calendarPlan.reason ?? undefined;
    if (calendarPlan.push && !saved.isDraft) {
      try {
        const result = await syncMeetingExternal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, saved.id);
        if (!result.ok) externalSyncError = result.error;
        saved.externalCalendarSyncStatus = result.status;
      } catch (err) {
        externalSyncError = err instanceof Error ? err.message : "External sync failed";
      }
      // The rest of the series, a few at a time. A failure on one is recorded
      // on its own row and retried by the sync sweep; it does not undo the
      // meetings already made.
      const rest = seriesIds.slice(1);
      for (let i = 0; i < rest.length; i += 4) {
        await Promise.allSettled(
          rest
            .slice(i, i + 4)
            .map((id) => syncMeetingExternal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, id)),
        );
      }
    }

    // Email guest invites once the meeting is a real (non-draft) saved meeting.
    // Non-fatal: an unconnected mailbox or send failure never blocks the meeting.
    // The host is emailed too, and both sides get a real calendar invitation —
    // so this runs even with no guests, because the host's own confirmation is
    // what puts the meeting in their calendar.
    let invited = 0;
    // How many messages the send TRIED to write. Without this the caller cannot
    // tell "nobody had an address" from "every send was refused", and the
    // scheduling screen only spoke when `invited > 0` — so a meeting whose
    // entire invite batch failed saved in complete silence.
    let attempted = 0;
    let inviteFailures: string[] = [];
    let inviteReasons: string[] = [];
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
            whenLabel: repeat && saved.scheduledAt
              ? describeRepeat(repeat, saved.scheduledAt, timezone)
              : saved.scheduledAt
                ? formatSlotFull(saved.scheduledAt, timezone)
                : null,
            // One invitation for the whole series, which each guest's calendar
            // expands from its rule.
            series:
              repeat && seriesIds.length > 1
                ? { seriesId: saved.id, rrule: seriesRrule(repeat), timezone }
                : null,
          });
          invited = result.sent;
          attempted = result.attempted;
          inviteFailures = result.failed;
          inviteReasons = result.reasons;
          if (result.sent === 0 && result.attempted > 0) {
            // Loud in the server log too. A send that reached nobody is an
            // operational fault — usually a credential Google has expired —
            // and it was previously invisible on both sides.
            console.error("[/api/meetings/schedule] invite send reached nobody", {
              attempted: result.attempted,
              reasons: result.reasons,
            });
          }
        } catch (err) {
          console.error("[/api/meetings/schedule] invite send failed", err);
          // A throw is not "nothing to send": the host has to hear about it.
          attempted = attempted || 1;
          inviteReasons = [err instanceof Error ? err.message : "the send failed"];
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
      calendarNote,
      calendarConnected,
      invited,
      // Everything the send is answerable for, so a zero is never ambiguous.
      attempted,
      inviteFailures,
      inviteReasons,
      uninvited,
      mailboxConnected,
      mailboxProblem,
      conflicts,
      // How many meetings this save made: 1, or the length of the series.
      seriesCount: seriesIds.length,
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
