import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { deleteMeetingLocal, updateMeeting, buildMeetingInviteUrl } from "@/lib/meetings/service";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import { diffMeetingPlace, diffMeetingTiming, sendMeetingUpdates } from "@/lib/meetings/meeting-updates";
import { conflictMessage, findConflicts, type ConflictCandidate } from "@/lib/meetings/schedule";
import { loadBlockConflicts } from "@/lib/meetings/blocks.server";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";
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
      "attendees, room_code, is_draft, host_id, scheduled_at, duration_minutes, title, timezone, calendar_sequence, location, meeting_url",
    )
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  // Same directory lookup the create path runs: an attendee typed as a bare
  // name is matched to the teammate it names, so adding somebody to an existing
  // meeting emails them instead of silently doing nothing.
  let nextAttendees = Array.isArray(body.attendees) ? (body.attendees as MeetingAttendeeInput[]) : undefined;
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
      const { data: candidates } = await supabase
        .from("live_meetings")
        .select("id, title, scheduled_at, duration_minutes, host_id, attendees")
        .eq("organization_id", auth.ctx.orgId)
        .is("deleted_at", null)
        .eq("is_draft", false)
        .neq("status", "ended")
        .gte("scheduled_at", windowStart)
        .lt("scheduled_at", endIso)
        .limit(200);
      const subjectAttendees = nextAttendees ?? (prior.attendees as MeetingAttendeeInput[] | null) ?? [];
      const conflicts = findConflicts((candidates ?? []) as ConflictCandidate[], startIso, endIso, {
        excludeId: id,
        subjectHostId: (prior.host_id as string | null) ?? null,
        subjectEmails: guestEmails(subjectAttendees),
      });
      const blockedBy = await loadBlockConflicts(supabase, auth.ctx.userId, startIso, endIso);
      if ((conflicts.length > 0 || blockedBy.length > 0) && body.allowConflict !== true) {
        return NextResponse.json(
          { error: conflictMessage(conflicts.length, blockedBy.length), conflicts, blockedBy },
          { status: 409 },
        );
      }
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

  try {
    const result = await updateMeeting(
      supabase,
      { orgId: auth.ctx.orgId, userId: auth.ctx.userId },
      id,
      {
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
        relatedCompanyId: cleanString(body.relatedCompanyId),
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
        externalCalendarProvider: cleanString(body.externalCalendarProvider),
        externalCalendarSyncEnabled: typeof body.externalCalendarSyncEnabled === "boolean" ? body.externalCalendarSyncEnabled : undefined,
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
      } catch (err) {
        console.error("[/api/meetings/[id]] invite send failed", err);
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

    return NextResponse.json({ ...result, invited, uninvited, notified, mailboxConnected, mailboxProblem });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update meeting" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof body?.reason === "string" ? body.reason.trim() || null : null;

  const { data: prior } = await supabase
    .from("live_meetings")
    .select("attendees, room_code, is_draft, scheduled_at, duration_minutes, title, timezone, calendar_sequence")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

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
        inviteeTimezone: cancelled.booking.invitee_timezone,
        hostTimezone: cancelled.page.timezone,
        startIso: cancelled.booking.starts_at,
        endIso: cancelled.booking.ends_at,
        durationMinutes: cancelled.eventType.duration_minutes,
        // The booking is gone, so the invitee gets the booking page back rather
        // than a manage link for something that no longer exists.
        manageUrl: buildBookingPageUrl(SITE_URL, cancelled.page.slug),
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
