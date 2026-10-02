import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import {
  deleteMeetingLocal,
  loadSeriesRows,
  markSeriesOccurrence,
  setSeriesRule,
  updateMeeting,
  buildMeetingInviteUrl,
  type UpdateMeetingInput,
} from "@/lib/meetings/service";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import { planCalendarSync } from "@/lib/meetings/calendar-sync";
import { canWriteCalendar } from "@/lib/calendar/google-write.server";
import {
  diffMeetingPlace,
  diffMeetingTiming,
  sendMeetingUpdates,
  sendSeriesEnded,
  seriesUpdateContext,
} from "@/lib/meetings/meeting-updates";
import { ruleFromRrule, seriesRrule, shiftSeriesStarts, truncateRule } from "@/lib/meetings/recurrence";
import {
  conflictGate,
  conflictMessage,
  findConflicts,
  findConflictsAcross,
  overlapsAnyWindow,
  type ConflictCandidate,
} from "@/lib/meetings/schedule";
import { loadBlockConflicts } from "@/lib/meetings/blocks.server";
import { loadExternalConflicts, loadSeriesExternalConflicts } from "@/lib/meetings/conflicts.server";
import { normalizeAttendees, type MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { needsDirectory, resolveAttendeeDirectory } from "@/lib/meetings/directory";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { SITE_URL } from "@/lib/site";
import {
  SlotUnavailableError,
  cancelBooking,
  loadLiveBookingByMeetingId,
  rescheduleBooking,
  type BookingContext,
} from "@/lib/meetings/scheduling-service";
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";
import { buildBookingManageUrl, buildBookingPageUrl, formatSlotFull } from "@/lib/meetings/scheduling";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

function cleanString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  return text || null;
}

/**
 * A meeting created by a scheduling link, if this is one. Bookings grant
 * clients no write policy, so the whole booking side runs service-role; a
 * deployment without service credentials just skips it rather than failing the
 * host's edit.
 */
async function loadLinkedBooking(meetingId: string): Promise<BookingContext | null> {
  if (!hasSupabaseServiceEnv()) return null;
  try {
    return await loadLiveBookingByMeetingId(createServiceClient(), meetingId);
  } catch (err) {
    console.error("[/api/meetings/[id]] linked booking lookup failed", err);
    return null;
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = await createServerClient();

  // Load the current row once: it drives the newly-added-guest invite diff,
  // conflict detection when the timing changes, and the update notices that go
  // to everyone who was already on the meeting.
  const { data: prior } = await supabase
    .from("live_meetings")
    .select(
      "attendees, room_code, is_draft, host_id, scheduled_at, duration_minutes, title, timezone, calendar_sequence, location, meeting_url, series_id, series_index, series_original_start",
    )
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  // Same directory lookup the create path runs: an attendee typed as a bare
  // name is matched to the teammate it names, so adding somebody to an existing
  // meeting emails them instead of silently doing nothing.
  // Same untrusted-body reasoning as the create path: a malformed element is a
  // 422, not a crash in the directory step.
  let nextAttendees = Array.isArray(body.attendees) ? normalizeAttendees(body.attendees) : undefined;
  if (nextAttendees === null) {
    return NextResponse.json(
      { error: "Check the attendee list.", fieldErrors: { attendees: "Each attendee needs a name or an email address." } },
      { status: 422 },
    );
  }
  let uninvited = 0;
  if (nextAttendees && needsDirectory(nextAttendees)) {
    const resolution = resolveAttendeeDirectory(nextAttendees, await loadOrgDirectory(supabase, auth.ctx.orgId));
    nextAttendees = resolution.attendees;
    uninvited = resolution.unreachable.length;
  }
  const priorEmails = guestEmails((prior?.attendees as MeetingAttendeeInput[] | null) ?? []);
  const priorGuestEmails = new Set(priorEmails);
  const roomCode = (prior?.room_code as string | null) ?? "";
  const isDraft = (prior?.is_draft as boolean | null) ?? false;
  // One meeting of a repeating series: guests hold the series, so what they are
  // told about this meeting has to name the series and this instance of it.
  const series = seriesUpdateContext(prior);

  // What the meeting's timing looks like on either side of this edit. An
  // untouched field keeps its prior value, so re-saving the same instant is
  // correctly read as "nothing moved" and mails nobody.
  const priorStart = (prior?.scheduled_at as string | null) ?? null;
  const priorDuration = (prior?.duration_minutes as number | null) ?? null;
  const nextStart = body.scheduledAt !== undefined ? (cleanString(body.scheduledAt) ?? null) : priorStart;
  const nextDuration =
    body.durationMinutes !== undefined
      ? Math.min(480, Math.max(15, Number(body.durationMinutes) || 60))
      : priorDuration;
  const timing = diffMeetingTiming(
    { startIso: priorStart, durationMinutes: priorDuration },
    { startIso: nextStart, durationMinutes: nextDuration },
  );

  // Where the meeting happens, on either side of this edit. A moved room or a
  // swapped join link is the other change an attendee has to act on — their
  // calendar entry now points somewhere wrong — so it earns an email of its own
  // when the time itself did not move.
  const priorLocation = (prior?.location as string | null) ?? null;
  const priorMeetingUrl = (prior?.meeting_url as string | null) ?? null;
  const nextLocation = body.location !== undefined ? (cleanString(body.location) ?? null) : priorLocation;
  const nextMeetingUrl = body.meetingUrl !== undefined ? (cleanString(body.meetingUrl) ?? null) : priorMeetingUrl;
  const place = diffMeetingPlace(
    { location: priorLocation, meetingUrl: priorMeetingUrl },
    { location: nextLocation, meetingUrl: nextMeetingUrl },
  );

  // Conflict detection on reschedule — mirrors the create path. Runs only when a
  // real (non-draft) meeting's timing changes, is scoped to a shared person
  // (host/attendee), and is skippable with allowConflict ("Save anyway").
  const timingChanged = body.scheduledAt !== undefined || body.durationMinutes !== undefined;
  if (prior && !isDraft && timingChanged) {
    const startIso = (body.scheduledAt as string | undefined) ?? priorStart;
    if (startIso) {
      const rawDuration = body.durationMinutes !== undefined ? Number(body.durationMinutes) : priorDuration ?? 60;
      const duration = Math.min(480, Math.max(15, Number.isFinite(rawDuration) ? rawDuration : 60));
      const endIso = new Date(new Date(startIso).getTime() + duration * 60_000).toISOString();
      const windowStart = new Date(new Date(startIso).getTime() - 8 * 3600_000).toISOString();
      // Whose clock the warning is read in. Resolved here rather than reusing
      // the one computed further down, which is only reached once this check
      // has let the edit through.
      const conflictZone = (cleanString(body.timezone) ?? (prior.timezone as string | null)) || "UTC";
      // The meeting clash and both of the host's own calendars — time they
      // blocked by hand, and time already taken in a calendar they only
      // connected — asked at once, since none depends on another.
      const [{ data: candidates }, blockedBy, busyElsewhere] = await Promise.all([
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
        loadBlockConflicts(supabase, auth.ctx.userId, startIso, endIso),
        loadExternalConflicts(supabase, {
          userId: auth.ctx.userId,
          startIso,
          endIso,
          timezone: conflictZone,
        }),
      ]);
      const subjectAttendees = nextAttendees ?? (prior.attendees as MeetingAttendeeInput[] | null) ?? [];
      const conflicts = findConflicts((candidates ?? []) as ConflictCandidate[], startIso, endIso, {
        excludeId: id,
        subjectHostId: (prior.host_id as string | null) ?? null,
        subjectEmails: guestEmails(subjectAttendees),
      });
      // Every clash — another meeting, blocked time, a connected calendar —
      // warns, and "Save anyway" gets past all of them: it is the host's own time.
      const gate = conflictGate(
        { meetings: conflicts.length, blocks: blockedBy.length, external: busyElsewhere.length },
        body.allowConflict === true,
      );
      if (gate !== "ok") {
        return NextResponse.json(
          {
            error: conflictMessage(conflicts.length, blockedBy.length, busyElsewhere.length),
            overridable: true,
            conflicts,
            blockedBy,
            busyElsewhere,
          },
          { status: 409 },
        );
      }
    }
  }

  // Every column this edit writes, shared by the one meeting and, for "this
  // and following", by every later meeting of its series.
  const editInput: UpdateMeetingInput = {
    title: body.title === undefined ? undefined : String(body.title),
    description: cleanString(body.description),
    location: cleanString(body.location),
    meetingUrl: cleanString(body.meetingUrl),
    scheduledAt: cleanString(body.scheduledAt),
    durationMinutes: body.durationMinutes === undefined ? undefined : Number(body.durationMinutes),
    timezone: cleanString(body.timezone),
    meetingType: cleanString(body.meetingType),
    priority: body.priority,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    attendees: nextAttendees,
    relatedContactId: cleanString(body.relatedContactId),
    relatedDealId: cleanString(body.relatedDealId),
    relatedFundId: cleanString(body.relatedFundId),
    syncMode: body.syncMode === "pending_external" ? "pending_external" : "local_only",
    objective: cleanString(body.objective),
    agenda: cleanString(body.agenda),
    preparationRequirements: cleanString(body.preparationRequirements),
    attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
    calendarVisibility: body.calendarVisibility === undefined ? undefined : String(body.calendarVisibility),
    reminderMinutes: body.reminderMinutes === undefined ? undefined : (body.reminderMinutes === null ? null : Number(body.reminderMinutes)),
    assignedCopilotAgent: cleanString(body.assignedCopilotAgent),
    relatedRecordType: cleanString(body.relatedRecordType),
    relatedRecordId: cleanString(body.relatedRecordId),
    // Only an explicit boolean changes it — anything else leaves the
    // meeting's current admission policy exactly as the host set it.
    guestQuickAccess: typeof body.guestQuickAccess === "boolean" ? body.guestQuickAccess : undefined,
  };

  // "This and following": the edit applies to this meeting and every later
  // one of its series, which then continue as a series of their own.
  if (
    body.scope === "following" &&
    prior &&
    !isDraft &&
    typeof prior.series_id === "string" &&
    typeof prior.series_index === "number"
  ) {
    try {
      return await editSeriesFrom(supabase, auth.ctx, {
        meetingId: id,
        seriesId: prior.series_id,
        fromIndex: prior.series_index,
        roomCode,
        editInput,
        priorStart,
        nextStart,
        nextDuration,
        timezone: (cleanString(body.timezone) ?? (prior.timezone as string | null)) || "UTC",
        title: body.title ? String(body.title) : ((prior.title as string | null) ?? "Meeting"),
        timingChanged: timing.changed,
        allowConflict: body.allowConflict === true,
        hostId: (prior.host_id as string | null) ?? null,
        guestsCareAbout:
          timing.changed ||
          place.changed ||
          (body.title !== undefined && String(body.title).trim() !== ((prior.title as string | null) ?? "")),
        priorEmails,
        nextEmails: nextAttendees ? guestEmails(nextAttendees) : priorEmails,
        uninvited,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to update the meetings" },
        { status: 500 },
      );
    }
  }

  // A meeting booked through a scheduling link owns a booking row, and the
  // database forbids one host holding two live bookings over the same time.
  // Move the booking BEFORE the meeting: a rejected move then aborts the whole
  // edit, instead of leaving a moved meeting pointing at a stale booking.
  let booking = !isDraft && timing.changed && nextStart ? await loadLinkedBooking(id) : null;
  const bookingWasAt = booking?.booking.starts_at ?? null;
  if (booking && nextStart) {
    try {
      booking = await rescheduleBooking(createServiceClient(), booking, nextStart, {
        durationMinutes: nextDuration ?? undefined,
        // The host picked this time in their own calendar; their published link
        // availability does not govern it. The overlap constraint still does.
        enforceAvailability: false,
      });
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error("[/api/meetings/[id]] booking reschedule failed", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to move the linked booking" },
        { status: 500 },
      );
    }
  }

  // Where this meeting stands with the host's own calendar, decided from the
  // connection rather than from the request — the same rule the create path
  // uses, so editing a meeting cannot silently drop it off a calendar that
  // scheduling put it on.
  //
  // Unlike the create path, silence here means LEAVE IT ALONE. This is a PATCH:
  // `updateMeeting` treats undefined as "column untouched", and following the
  // connection on an unstated field would switch sync on for every meeting
  // saved before this existed — putting old meetings on a calendar during an
  // edit that was about something else entirely.
  const calendarStated = typeof body.externalCalendarSyncEnabled === "boolean";
  const editCalendarPlan = calendarStated
    ? planCalendarSync({
        connected: await canWriteCalendar(supabase, auth.ctx.userId),
        requested: body.externalCalendarSyncEnabled as boolean,
        isDraft,
      })
    : null;

  try {
    const result = await updateMeeting(
      supabase,
      { orgId: auth.ctx.orgId, userId: auth.ctx.userId },
      id,
      {
        ...editInput,
        // Derived from the connection, never read off the request. The form used
        // to offer Outlook, Calendly and iCal alongside Google, and
        // pushMeetingToGoogle is the only writer — so a meeting could be stored
        // as syncing to Outlook and then be pushed to Google or skipped.
        externalCalendarProvider: editCalendarPlan?.provider,
        externalCalendarSyncEnabled: editCalendarPlan?.enabled,
      },
    );

    // The sequence the trigger just bumped, not the one the row carried before
    // the save. A revision at a sequence the client already holds is discarded,
    // which is precisely how a reschedule fails to move anybody's calendar.
    const sequence = result.calendarSequence ?? ((prior?.calendar_sequence as number | null) ?? null);
    const title = body.title ? String(body.title) : ((prior?.title as string | null) ?? "Meeting");
    const timezone = (cleanString(body.timezone) ?? (prior?.timezone as string | null)) || "UTC";
    const senderName = auth.ctx.email ?? "Someone";
    // The host's own mailbox. Resolved once for every send this handler makes.
    // Non-blocking on purpose: email here is a side effect of saving the
    // meeting, and losing the save over an unconnected mailbox would cost more
    // than falling back to the org's.
    const mailbox = await mailboxFor(supabase, auth.ctx.userId, auth.ctx.orgId);
    const senderMailbox = mailbox.ok ? { gmailAccessToken: mailbox.token } : undefined;
    // Reported back so "notified 0" can be told apart from "your org cannot
    // send email at all", which otherwise looks identical to the host.
    const mailboxConnected = mailbox.ok;
    const mailboxProblem = mailbox.ok ? null : mailboxProblemMessage(mailbox.problem);
    const notifiable = !isDraft && !!roomCode;

    // The link invitee is already a guest on the meeting, but their booking
    // email carries the manage link and their own timezone. Send them that one
    // and keep them out of the generic guest notice, so a move is one email.
    const bookingInviteeEmail = booking?.booking.invitee_email?.trim().toLowerCase() ?? null;

    const nextEmails = nextAttendees ? guestEmails(nextAttendees) : null;
    const newEmails = nextEmails ? nextEmails.filter((e) => !priorGuestEmails.has(e)) : [];
    const removedEmails = nextEmails ? priorEmails.filter((e) => !nextEmails.includes(e)) : [];
    // Everyone who was on the meeting before and still is — the audience for a
    // reschedule. A guest added in this same save gets a fresh invite instead,
    // which already carries the new time.
    const retainedEmails = (nextEmails ? priorEmails.filter((e) => nextEmails.includes(e)) : priorEmails).filter(
      (e) => e !== bookingInviteeEmail,
    );

    // Invite guests that were just added to a real (non-draft) meeting.
    let invited = 0;
    // Same reason as the create path: a caller cannot read a zero without
    // knowing whether anything was tried, and the screen stayed silent on the
    // case that matters most.
    let attempted = 0;
    let inviteFailures: string[] = [];
    let inviteReasons: string[] = [];
    if (notifiable && newEmails.length > 0) {
      try {
        const sendResult = await sendMeetingInvites({
          credentials: senderMailbox,
          orgId: auth.ctx.orgId,
          // Canonical app URL so the emailed link is stable across hosts/proxies.
          origin: SITE_URL,
          roomCode,
          title,
          senderName,
          emails: newEmails,
          // The same invitation the create path sends. Without these a guest
          // added later got a "join" link and no idea when to use it — no time
          // in the email, and nothing that reached their calendar.
          hostEmail: auth.ctx.email ?? null,
          meetingId: id,
          startIso: nextStart,
          durationMinutes: nextDuration,
          // The trigger bumps the sequence on every save, so this invitation
          // carries the same calendar entry the others already hold.
          sequence,
          whenLabel: nextStart ? formatSlotFull(nextStart, timezone) : null,
          // The host is the ORGANIZER on that invitation, not an audience for
          // it: they are the one adding the guest, and already hold the meeting.
          notifyHost: false,
        });
        invited = sendResult.sent;
        attempted = sendResult.attempted;
        inviteFailures = sendResult.failed;
        inviteReasons = sendResult.reasons;
        if (sendResult.sent === 0 && sendResult.attempted > 0) {
          console.error("[/api/meetings/[id]] invite send reached nobody", {
            attempted: sendResult.attempted,
            reasons: sendResult.reasons,
          });
        }
      } catch (err) {
        console.error("[/api/meetings/[id]] invite send failed", err);
        attempted = attempted || newEmails.length;
        inviteReasons = [err instanceof Error ? err.message : "the send failed"];
      }
    }

    // Notifying is best-effort: the edit is already saved, and a failed send
    // must not tell the host their change didn't go through.
    let notified = 0;
    if (notifiable && timing.changed && retainedEmails.length > 0) {
      const res = await sendMeetingUpdates("rescheduled", {
        credentials: senderMailbox,
        // Same calendar entry as the invitation, at the sequence the trigger
        // has since bumped — so this moves or clears it rather than adding one.
        meetingId: id,
        series,
        hostEmail: auth.ctx.email ?? null,
        sequence,
        orgId: auth.ctx.orgId,
        origin: SITE_URL,
        roomCode,
        title,
        senderName,
        emails: retainedEmails,
        timezone,
        startIso: nextStart,
        previousStartIso: priorStart,
        durationMinutes: nextDuration,
        location: nextLocation,
        meetingUrl: nextMeetingUrl,
      });
      notified += res.sent;
    }

    // Only when the time did NOT move: a reschedule already carries the new
    // joining details, and two emails for one save is how a change gets read as
    // two changes.
    if (notifiable && !timing.changed && place.changed && retainedEmails.length > 0) {
      const res = await sendMeetingUpdates("relocated", {
        credentials: senderMailbox,
        meetingId: id,
        series,
        hostEmail: auth.ctx.email ?? null,
        sequence,
        orgId: auth.ctx.orgId,
        origin: SITE_URL,
        roomCode,
        title,
        senderName,
        emails: retainedEmails,
        timezone,
        startIso: nextStart,
        durationMinutes: nextDuration,
        location: nextLocation,
        previousLocation: priorLocation,
        meetingUrl: nextMeetingUrl,
        previousMeetingUrl: priorMeetingUrl,
      });
      notified += res.sent;
    }

    if (notifiable && removedEmails.length > 0) {
      const res = await sendMeetingUpdates("removed", {
        credentials: senderMailbox,
        // Same calendar entry as the invitation, at the sequence the trigger
        // has since bumped — so this moves or clears it rather than adding one.
        meetingId: id,
        series,
        hostEmail: auth.ctx.email ?? null,
        sequence,
        orgId: auth.ctx.orgId,
        origin: SITE_URL,
        roomCode,
        title,
        senderName,
        emails: removedEmails,
        timezone,
        startIso: nextStart,
      });
      notified += res.sent;
    }

    if (booking && timing.changed) {
      const res = await sendBookingEmails("rescheduled_by_host", {
        credentials: senderMailbox,
        orgId: auth.ctx.orgId,
        eventTitle: booking.eventType.title,
        hostName: booking.page.display_name,
        hostEmail: auth.ctx.email,
        inviteeName: booking.booking.invitee_name,
        inviteeEmail: booking.booking.invitee_email,
        guestEmails: booking.booking.invitee_guests ?? [],
        inviteeTimezone: booking.booking.invitee_timezone,
        hostTimezone: booking.page.timezone,
        startIso: booking.booking.starts_at,
        endIso: booking.booking.ends_at,
        previousStartIso: bookingWasAt,
        durationMinutes: nextDuration ?? booking.eventType.duration_minutes,
        joinUrl: booking.roomCode ? buildMeetingInviteUrl(SITE_URL, booking.roomCode) : null,
        manageUrl: buildBookingManageUrl(SITE_URL, booking.booking.manage_token),
        manageToken: booking.booking.manage_token,
        bookingId: booking.booking.id,
        bookingCreatedAt: booking.booking.created_at,
        bookingUpdatedAt: booking.booking.updated_at,
        bookingSequence: booking.booking.calendar_sequence,
        siteUrl: SITE_URL,
      });
      notified += res.sent;
    }

    return NextResponse.json({
      ...result,
      invited,
      attempted,
      inviteFailures,
      inviteReasons,
      uninvited,
      notified,
      mailboxConnected,
      mailboxProblem,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update meeting" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();
  const body = (await request.json().catch(() => ({}))) as { reason?: string; scope?: string };
  const reason = typeof body?.reason === "string" ? body.reason.trim() || null : null;

  const { data: prior } = await supabase
    .from("live_meetings")
    .select("attendees, room_code, is_draft, scheduled_at, duration_minutes, title, timezone, calendar_sequence, series_id, series_index, series_original_start")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  // "This and following": the rest of a repeating series goes with this one.
  // Anything else, or a meeting that does not repeat, is the one meeting.
  if (
    body?.scope === "following" &&
    prior &&
    !prior.is_draft &&
    typeof prior.series_id === "string" &&
    typeof prior.series_index === "number"
  ) {
    try {
      return NextResponse.json(
        await cancelSeriesFrom(supabase, auth.ctx, {
          seriesId: prior.series_id,
          fromIndex: prior.series_index,
          title: (prior.title as string | null) ?? "Meeting",
          timezone: ((prior.timezone as string | null) ?? "UTC") || "UTC",
          attendees: (prior.attendees as MeetingAttendeeInput[] | null) ?? [],
          reason,
        }),
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to cancel the meetings" },
        { status: 500 },
      );
    }
  }

  try {
    // Cancel the booking first, for the same reason a reschedule moves it
    // first: a booking left live against a deleted meeting would keep its slot
    // blocked and still show the invitee a meeting that no longer exists.
    const booking = prior && !prior.is_draft ? await loadLinkedBooking(id) : null;
    let cancelled: BookingContext | null = null;
    if (booking) {
      try {
        cancelled = await cancelBooking(createServiceClient(), booking, "host", reason);
      } catch (err) {
        console.error("[/api/meetings/[id]] booking cancel failed", err);
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Failed to cancel the linked booking" },
          { status: 500 },
        );
      }
    }

    const result = await deleteMeetingLocal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, id);

    // Same as the PATCH handler: the host's own mailbox, non-blocking, because
    // a cancellation must not fail over an unconnected mailbox.
    const deleteMailbox = await mailboxFor(supabase, auth.ctx.userId, auth.ctx.orgId);
    const senderMailbox = deleteMailbox.ok ? { gmailAccessToken: deleteMailbox.token } : undefined;

    const bookingInviteeEmail = cancelled?.booking.invitee_email?.trim().toLowerCase() ?? null;
    const emails = guestEmails((prior?.attendees as MeetingAttendeeInput[] | null) ?? []).filter(
      (e) => e !== bookingInviteeEmail,
    );
    const notifiable = !!prior && !prior.is_draft && !!prior.room_code;

    let notified = 0;
    if (notifiable && emails.length > 0) {
      const res = await sendMeetingUpdates("cancelled", {
        credentials: senderMailbox,
        // Same calendar entry as the invitation, at the sequence the soft
        // delete just bumped — a CANCEL at a sequence the client already holds
        // leaves the meeting sitting in their calendar.
        meetingId: id,
        // One meeting of a series is cancelled as that instance, not the series.
        series: seriesUpdateContext(prior),
        hostEmail: auth.ctx.email ?? null,
        sequence: result.calendarSequence ?? ((prior?.calendar_sequence as number | null) ?? null),
        orgId: auth.ctx.orgId,
        origin: SITE_URL,
        roomCode: (prior?.room_code as string | null) ?? "",
        title: (prior?.title as string | null) ?? "Meeting",
        senderName: auth.ctx.email ?? "Someone",
        emails,
        timezone: ((prior?.timezone as string | null) ?? "UTC") || "UTC",
        startIso: (prior?.scheduled_at as string | null) ?? null,
        durationMinutes: (prior?.duration_minutes as number | null) ?? null,
        reason,
      });
      notified += res.sent;
    }

    if (cancelled) {
      const res = await sendBookingEmails("cancelled_by_host", {
        credentials: senderMailbox,
        orgId: auth.ctx.orgId,
        eventTitle: cancelled.eventType.title,
        hostName: cancelled.page.display_name,
        hostEmail: auth.ctx.email,
        inviteeName: cancelled.booking.invitee_name,
        inviteeEmail: cancelled.booking.invitee_email,
        guestEmails: cancelled.booking.invitee_guests ?? [],
        inviteeTimezone: cancelled.booking.invitee_timezone,
        hostTimezone: cancelled.page.timezone,
        startIso: cancelled.booking.starts_at,
        endIso: cancelled.booking.ends_at,
        durationMinutes: cancelled.eventType.duration_minutes,
        // The booking is gone, so the invitee gets the booking page back rather
        // than a manage link for something that no longer exists.
        manageUrl: buildBookingPageUrl(SITE_URL, cancelled.page.slug, undefined, {
          name: cancelled.booking.invitee_name,
          email: cancelled.booking.invitee_email,
        }),
        reason,
        bookingId: cancelled.booking.id,
        bookingCreatedAt: cancelled.booking.created_at,
        bookingUpdatedAt: cancelled.booking.updated_at,
        bookingSequence: cancelled.booking.calendar_sequence,
        siteUrl: SITE_URL,
      });
      notified += res.sent;
    }

    return NextResponse.json({ ...result, notified });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete meeting" }, { status: 500 });
  }
}

/**
 * Cancel one meeting of a series and every one after it.
 *
 * Each meeting is its own row and is cancelled as one, but guests hold the
 * series as a single repeating entry, so they get one email about the series:
 * it now ends sooner, or (from its first meeting) is off altogether. The
 * meetings that stay carry the shortened rule, so the next cut starts from it.
 */
async function cancelSeriesFrom(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  actor: { orgId: string; userId: string; email?: string | null },
  opts: {
    seriesId: string;
    fromIndex: number;
    title: string;
    timezone: string;
    attendees: MeetingAttendeeInput[];
    reason: string | null;
  },
): Promise<{ ok: true; cancelled: number; notified: number }> {
  const rows = await loadSeriesRows(supabase, actor.orgId, opts.seriesId);
  const live = rows.filter((r) => !r.deleted_at);
  const tail = live.filter((r) => (r.series_index ?? -1) >= opts.fromIndex);
  const kept = live.filter((r) => (r.series_index ?? -1) < opts.fromIndex);

  // Each meeting is soft-deleted the same way a single cancel does it, so its
  // room, reminders and audit trail behave exactly as they always have.
  let sequence = 0;
  for (const row of tail) {
    const result = await deleteMeetingLocal(supabase, { orgId: actor.orgId, userId: actor.userId }, row.id);
    sequence = Math.max(sequence, result.calendarSequence ?? row.calendar_sequence ?? 0);
  }

  const first = rows.find((r) => r.series_index === 0) ?? rows[0];
  const rule = ruleFromRrule(first?.series_rule ?? tail[0]?.series_rule);
  const keepRule = rule ? truncateRule(rule, opts.fromIndex) : null;
  const keepRrule = keepRule ? seriesRrule(keepRule) : null;
  if (keepRrule) {
    sequence = Math.max(
      sequence,
      await setSeriesRule(
        supabase,
        actor.orgId,
        kept.map((r) => r.id),
        keepRrule,
      ),
    );
  }

  const emails = guestEmails(opts.attendees);
  const fromStartIso = tail[0]?.series_original_start ?? tail[0]?.scheduled_at ?? null;
  const firstStartIso = first?.series_original_start ?? first?.scheduled_at ?? null;
  let notified = 0;
  if (tail.length > 0 && emails.length > 0 && fromStartIso && firstStartIso) {
    const mailbox = await mailboxFor(supabase, actor.userId, actor.orgId);
    const res = await sendSeriesEnded({
      credentials: mailbox.ok ? { gmailAccessToken: mailbox.token } : undefined,
      orgId: actor.orgId,
      origin: SITE_URL,
      title: opts.title,
      senderName: actor.email ?? "Someone",
      hostEmail: actor.email ?? null,
      emails,
      timezone: opts.timezone,
      seriesId: opts.seriesId,
      // Above every sequence the series' meetings have carried, which is above
      // the one guests hold for the series itself.
      sequence: Math.max(sequence, ...rows.map((r) => r.calendar_sequence ?? 0)) + 1,
      firstStartIso,
      durationMinutes: first?.duration_minutes ?? null,
      keepRrule,
      fromStartIso,
      cancelled: tail.length,
      reason: opts.reason,
    });
    notified = res.sent;
  }

  return { ok: true, cancelled: tail.length, notified };
}

/**
 * Apply an edit to one meeting of a series and every meeting after it.
 *
 * Guests hold the series as one repeating entry, and an entry cannot change
 * from its middle. So the series is split, as calendars themselves do it: the
 * original now ends before this meeting, and this meeting and the rest become
 * a series of their own, with this meeting as its first, and a new invitation.
 * From the first meeting there is nothing to split; the series is re-issued
 * under the identity guests already hold.
 */
async function editSeriesFrom(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  actor: { orgId: string; userId: string; email?: string | null },
  opts: {
    meetingId: string;
    seriesId: string;
    fromIndex: number;
    roomCode: string;
    editInput: UpdateMeetingInput;
    priorStart: string | null;
    nextStart: string | null;
    nextDuration: number | null;
    timezone: string;
    title: string;
    timingChanged: boolean;
    allowConflict: boolean;
    /** Whose meeting this is, for telling a clash with a shared person apart. */
    hostId: string | null;
    guestsCareAbout: boolean;
    priorEmails: string[];
    nextEmails: string[];
    uninvited: number;
  },
): Promise<NextResponse> {
  const rows = await loadSeriesRows(supabase, actor.orgId, opts.seriesId);
  const live = rows.filter((r) => !r.deleted_at);
  const tail = live.filter((r) => (r.series_index ?? -1) >= opts.fromIndex);
  const kept = live.filter((r) => (r.series_index ?? -1) < opts.fromIndex);
  const first = rows.find((r) => r.series_index === 0) ?? rows[0];
  const self = tail.find((r) => r.id === opts.meetingId);
  if (!self) throw new Error("Meeting not found in its series");

  const rule = ruleFromRrule(first?.series_rule ?? self.series_rule);
  if (!rule) throw new Error("This meeting's series has no repeat rule");
  // The rest of the rule from this slot on, whichever of its meetings are
  // still live: a meeting cancelled on its own stays cancelled.
  const restRrule = seriesRrule({ freq: rule.freq, count: Math.max(1, rule.count - opts.fromIndex) });

  const slotOf = (r: { series_original_start: string | null; scheduled_at: string | null }) =>
    r.series_original_start ?? r.scheduled_at ?? "";
  const startMoved =
    !!opts.nextStart &&
    !!opts.priorStart &&
    new Date(opts.nextStart).getTime() !== new Date(opts.priorStart).getTime();
  // Where each meeting now falls, and the slot the new rule gives it.
  const slots = startMoved
    ? shiftSeriesStarts(tail.map(slotOf), slotOf(self), opts.nextStart!, opts.timezone)
    : tail.map(slotOf);
  const starts = startMoved ? slots : tail.map((r) => r.scheduled_at ?? slotOf(r));

  // This meeting was checked on the way in; the rest are checked here, as for
  // a new series: other meetings, time blocked by hand and busy time in a
  // connected calendar, across every later meeting, all warn with "Save anyway"
  // and none refuses. The series' own meetings are moving with this edit, so
  // they are left out.
  if (opts.timingChanged && !opts.allowConflict) {
    const others = starts.filter((_, i) => tail[i].id !== opts.meetingId);
    const windows = others.map((startIso) => ({
      startIso,
      endIso: new Date(new Date(startIso).getTime() + (opts.nextDuration ?? 60) * 60_000).toISOString(),
    }));
    if (windows.length > 0) {
      const spanStart = new Date(new Date(windows[0].startIso).getTime() - 8 * 3600_000).toISOString();
      const spanEnd = windows[windows.length - 1].endIso;
      const moving = new Set(tail.map((r) => r.id));
      const [{ data: candidates }, blocks, busyElsewhere] = await Promise.all([
        supabase
          .from("live_meetings")
          .select("id, title, scheduled_at, duration_minutes, host_id, attendees")
          .eq("organization_id", actor.orgId)
          .is("deleted_at", null)
          .eq("is_draft", false)
          .neq("status", "ended")
          .gte("scheduled_at", spanStart)
          .lt("scheduled_at", spanEnd)
          .limit(1000),
        loadBlockConflicts(supabase, actor.userId, windows[0].startIso, spanEnd),
        loadSeriesExternalConflicts(supabase, {
          userId: actor.userId,
          starts: others,
          durationMinutes: opts.nextDuration ?? 60,
          timezone: opts.timezone,
        }),
      ]);
      const conflicts = findConflictsAcross(
        ((candidates ?? []) as ConflictCandidate[]).filter((c) => !moving.has(c.id)),
        windows,
        { subjectHostId: opts.hostId, subjectEmails: opts.nextEmails },
      );
      const blockedBy = blocks.filter((b) => overlapsAnyWindow(b.startsAt, b.endsAt, windows));
      if (conflicts.length > 0 || blockedBy.length > 0 || busyElsewhere.length > 0) {
        return NextResponse.json(
          {
            error: conflictMessage(conflicts.length, blockedBy.length, busyElsewhere.length),
            overridable: true,
            conflicts,
            blockedBy,
            busyElsewhere,
          },
          { status: 409 },
        );
      }
    }
  }

  let sequence = 0;
  let selfSequence: number | null = null;
  for (let i = 0; i < tail.length; i += 1) {
    const row = tail[i];
    const result = await updateMeeting(supabase, { orgId: actor.orgId, userId: actor.userId }, row.id, {
      ...opts.editInput,
      scheduledAt: startMoved ? starts[i] : undefined,
    });
    // The rest of the series is a series of its own now, with this meeting
    // first. From the first meeting that is the same series it always was.
    await markSeriesOccurrence(supabase, row.id, {
      seriesId: opts.meetingId,
      index: i,
      rule: restRrule,
      start: slots[i],
    });
    sequence = Math.max(sequence, result.calendarSequence ?? 0);
    if (row.id === opts.meetingId) selfSequence = result.calendarSequence;
  }
  const split = opts.fromIndex > 0;
  const keepRrule = split ? seriesRrule({ freq: rule.freq, count: opts.fromIndex }) : null;
  if (keepRrule && kept.length > 0) {
    sequence = Math.max(
      sequence,
      await setSeriesRule(
        supabase,
        actor.orgId,
        kept.map((r) => r.id),
        keepRrule,
      ),
    );
  }
  sequence = Math.max(sequence, ...rows.map((r) => r.calendar_sequence ?? 0)) + 1;

  const mailbox = await mailboxFor(supabase, actor.userId, actor.orgId);
  const credentials = mailbox.ok ? { gmailAccessToken: mailbox.token } : undefined;
  const senderName = actor.email ?? "Someone";
  const removedEmails = opts.priorEmails.filter((e) => !opts.nextEmails.includes(e));
  const addedEmails = opts.nextEmails.filter((e) => !opts.priorEmails.includes(e));
  const retainedEmails = opts.priorEmails.filter((e) => opts.nextEmails.includes(e));
  const ending = {
    origin: SITE_URL,
    orgId: actor.orgId,
    credentials,
    title: opts.title,
    senderName,
    hostEmail: actor.email ?? null,
    timezone: opts.timezone,
    seriesId: opts.seriesId,
    sequence,
    firstStartIso: slotOf(first ?? self),
    durationMinutes: first?.duration_minutes ?? opts.nextDuration,
    keepRrule,
    fromStartIso: slotOf(self),
    cancelled: tail.length,
  };

  let notified = 0;
  let invited = 0;
  let attempted = 0;
  let inviteFailures: string[] = [];
  let inviteReasons: string[] = [];
  const somethingToSay = opts.guestsCareAbout || removedEmails.length > 0 || addedEmails.length > 0;
  if (opts.roomCode && somethingToSay) {
    // The old series, told where it now ends: those staying on hear that the
    // rest moved to a new invitation, those dropped that they are off it.
    if (split && retainedEmails.length > 0) {
      notified += (await sendSeriesEnded({ ...ending, emails: retainedEmails, variant: "changed" })).sent;
    }
    if (removedEmails.length > 0) {
      notified += (await sendSeriesEnded({ ...ending, emails: removedEmails, variant: "removed" })).sent;
    }
    // The rest of the series as it now is, to everyone on it: a new series
    // after a split, or the same one re-issued from its first meeting.
    const audience = split ? opts.nextEmails : [...retainedEmails, ...addedEmails];
    if (audience.length > 0 && (split || opts.guestsCareAbout || addedEmails.length > 0)) {
      try {
        const sent = await sendMeetingInvites({
          credentials,
          orgId: actor.orgId,
          origin: SITE_URL,
          roomCode: opts.roomCode,
          title: opts.title,
          senderName,
          emails: split || opts.guestsCareAbout ? audience : addedEmails,
          hostEmail: actor.email ?? null,
          meetingId: opts.meetingId,
          startIso: slots[tail.indexOf(self)] ?? opts.nextStart,
          durationMinutes: opts.nextDuration,
          sequence: split ? (selfSequence ?? 0) : sequence,
          whenLabel: opts.nextStart ? formatSlotFull(opts.nextStart, opts.timezone) : null,
          notifyHost: false,
          series: { seriesId: opts.meetingId, rrule: restRrule, timezone: opts.timezone },
        });
        invited = sent.sent;
        attempted = sent.attempted;
        inviteFailures = sent.failed;
        inviteReasons = sent.reasons;
      } catch (err) {
        console.error("[/api/meetings/[id]] series invite failed", err);
        inviteReasons = [err instanceof Error ? err.message : "the send failed"];
      }
    }
  }

  return NextResponse.json({
    ok: true,
    calendarSequence: selfSequence,
    seriesUpdated: tail.length,
    invited,
    attempted,
    inviteFailures,
    inviteReasons,
    uninvited: opts.uninvited,
    notified,
    mailboxConnected: mailbox.ok,
    mailboxProblem: mailbox.ok ? null : mailboxProblemMessage(mailbox.problem),
  });
}
