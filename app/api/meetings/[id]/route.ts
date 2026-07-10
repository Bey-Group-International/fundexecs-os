import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { deleteMeetingLocal, updateMeeting } from "@/lib/meetings/service";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import { findConflicts, type ConflictCandidate } from "@/lib/meetings/schedule";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

function cleanString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  return text || null;
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = await createServerClient();

  // Load the current row once: it drives both the newly-added-guest invite diff
  // and conflict detection when the timing changes.
  const { data: prior } = await supabase
    .from("live_meetings")
    .select("attendees, room_code, is_draft, host_id, scheduled_at, duration_minutes")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  const nextAttendees = Array.isArray(body.attendees) ? (body.attendees as MeetingAttendeeInput[]) : undefined;
  const priorGuestEmails = new Set(guestEmails((prior?.attendees as MeetingAttendeeInput[] | null) ?? []));
  const roomCode = (prior?.room_code as string | null) ?? "";
  const isDraft = (prior?.is_draft as boolean | null) ?? false;

  // Conflict detection on reschedule — mirrors the create path. Runs only when a
  // real (non-draft) meeting's timing changes, is scoped to a shared person
  // (host/attendee), and is skippable with allowConflict ("Save anyway").
  const timingChanged = body.scheduledAt !== undefined || body.durationMinutes !== undefined;
  if (prior && !isDraft && timingChanged) {
    const startIso = (body.scheduledAt as string | undefined) ?? (prior.scheduled_at as string | null) ?? null;
    if (startIso) {
      const rawDuration = body.durationMinutes !== undefined ? Number(body.durationMinutes) : (prior.duration_minutes as number | null) ?? 60;
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
      if (conflicts.length > 0 && body.allowConflict !== true) {
        return NextResponse.json({ error: "Time conflicts with another meeting.", conflicts }, { status: 409 });
      }
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
        attendees: Array.isArray(body.attendees) ? body.attendees : undefined,
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

    // Invite guests that were just added to a real (non-draft) meeting.
    let invited = 0;
    if (nextAttendees && !isDraft && roomCode) {
      const newEmails = guestEmails(nextAttendees).filter((e) => !priorGuestEmails.has(e));
      if (newEmails.length > 0) {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const sendResult = await sendMeetingInvites({
            // Canonical app URL so the emailed link is stable across hosts/proxies.
            origin: SITE_URL,
            roomCode,
            title: body.title ? String(body.title) : "Meeting",
            senderName: userData.user?.email ?? "Someone",
            emails: newEmails,
          });
          invited = sendResult.sent;
        } catch (err) {
          console.error("[/api/meetings/[id]] invite send failed", err);
        }
      }
    }

    return NextResponse.json({ ...result, invited });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update meeting" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();

  try {
    return NextResponse.json(await deleteMeetingLocal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete meeting" }, { status: 500 });
  }
}
