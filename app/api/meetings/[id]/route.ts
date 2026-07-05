import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { deleteMeetingLocal, updateMeeting } from "@/lib/meetings/service";
import { sendMeetingInvites, guestEmails } from "@/lib/meetings/invite";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";

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

  // Snapshot attendees + room before the edit so we can invite only guests that
  // are newly added (avoids re-emailing everyone on every edit).
  const nextAttendees = Array.isArray(body.attendees) ? (body.attendees as MeetingAttendeeInput[]) : undefined;
  let priorGuestEmails: Set<string> = new Set();
  let roomCode = "";
  let isDraft = false;
  if (nextAttendees) {
    const { data: prior } = await supabase
      .from("live_meetings")
      .select("attendees, room_code, is_draft")
      .eq("id", id)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();
    if (prior) {
      priorGuestEmails = new Set(guestEmails((prior.attendees as MeetingAttendeeInput[] | null) ?? []));
      roomCode = (prior.room_code as string | null) ?? "";
      isDraft = (prior.is_draft as boolean | null) ?? false;
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
            origin: request.nextUrl.origin,
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
