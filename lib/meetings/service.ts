import type { createServerClient } from "@/lib/supabase/server";
import type { Json, LiveMeeting } from "@/lib/supabase/database.types";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { nextExternalSyncStatus, type ExternalSyncStatus } from "@/lib/meetings/schedule";
import { pushMeetingToGoogle } from "@/lib/calendar/google-write.server";
import type { WritableMeeting } from "@/lib/calendar/google-write";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

const ROOM_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";

export interface CreateMeetingInput {
  title?: string;
  orgId: string | null;
  hostId: string;
  dealId?: string | null;
  roomCode?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  timezone?: string | null;
  meetingType?: string | null;
}

export interface CreatedMeeting {
  id: string;
  roomCode: string;
  hostId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
}

export interface UpdateMeetingInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  timezone?: string | null;
  meetingType?: string | null;
  priority?: "low" | "normal" | "high" | "critical";
  tags?: string[];
  attendees?: Array<{ name: string; email?: string; type?: "internal" | "external" }>;
  relatedContactId?: string | null;
  relatedCompanyId?: string | null;
  relatedDealId?: string | null;
  relatedFundId?: string | null;
  syncMode?: "local_only" | "pending_external";
  // Institutional Meeting Edit Screen fields.
  objective?: string | null;
  agenda?: string | null;
  preparationRequirements?: string | null;
  attachments?: Array<{ name: string; url?: string | null }>;
  calendarVisibility?: string;
  reminderMinutes?: number | null;
  assignedCopilotAgent?: string | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  externalCalendarSyncEnabled?: boolean;
  externalCalendarProvider?: string | null;
}

export interface PersistMeetingRecordInput {
  meeting: Pick<LiveMeeting, "id" | "organization_id" | "deal_id" | "title">;
  actorId: string;
  participants?: string[];
  transcript: string;
  analysis: Record<string, unknown>;
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 10; i++) {
    if (i === 3 || i === 7) {
      code += "-";
      continue;
    }
    code += ROOM_CHARS[bytes[i] % ROOM_CHARS.length];
  }
  return code;
}

function cleanDuration(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 60;
  return Math.min(480, Math.max(15, Math.trunc(value!)));
}

export function buildMeetingInviteUrl(origin: string, roomCode: string): string {
  return `${origin.replace(/\/$/, "")}/meeting-invite/${roomCode}`;
}

export function buildMeetingRoomUrl(origin: string, roomCode: string): string {
  return `${origin.replace(/\/$/, "")}/meetings/${roomCode}`;
}

export async function createMeeting(
  supabase: ServerClient,
  input: CreateMeetingInput,
): Promise<CreatedMeeting> {
  const roomCode = input.roomCode?.trim() || generateRoomCode();
  const duration = cleanDuration(input.durationMinutes);

  const { data, error } = await (supabase.from("live_meetings") as ReturnType<typeof supabase.from>)
    .upsert(
      {
        room_code: roomCode,
        title: input.title?.trim() || "Meeting",
        host_id: input.hostId,
        organization_id: input.orgId,
        deal_id: input.dealId ?? null,
        status: "waiting",
        description: null,
        location: null,
        meeting_url: null,
        attendees: [] as Json,
        source: "fundexecs",
        sync_status: "local_only",
        priority: "normal",
        tags: [],
        scheduled_at: input.scheduledAt ?? null,
        duration_minutes: duration,
        timezone: input.timezone?.trim() || "UTC",
        meeting_type: input.meetingType?.trim() || "internal_strategy",
        preparation_status: input.scheduledAt ? "prep_needed" : "ready",
        followup_status: "not_started",
      } as never,
      { onConflict: "room_code", ignoreDuplicates: false },
    )
    .select("id, room_code, host_id, scheduled_at, duration_minutes")
    .single();

  if (error) throw error;
  return {
    id: data.id,
    roomCode: data.room_code,
    hostId: data.host_id,
    scheduledAt: data.scheduled_at ?? null,
    durationMinutes: data.duration_minutes ?? duration,
  };
}

function cleanTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 20);
}

export interface ScheduleMeetingInput {
  meetingId?: string | null;
  orgId: string;
  hostId: string;
  draft?: boolean;
  title: string;
  meetingType: string;
  scheduledAt: string;
  durationMinutes: number;
  timezone: string;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  objective?: string | null;
  agenda?: string | null;
  preparationRequirements?: string | null;
  attendees?: MeetingAttendeeInput[];
  attachments?: Array<{ name: string; url?: string | null }>;
  assignedCopilotAgent?: string | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  dealId?: string | null;
  calendarVisibility?: string;
  reminderMinutes?: number | null;
  priority?: "low" | "normal" | "high" | "critical";
  tags?: string[];
  externalCalendarSyncEnabled?: boolean;
  externalCalendarProvider?: string | null;
}

export interface SavedScheduledMeeting {
  id: string;
  roomCode: string;
  scheduledAt: string | null;
  durationMinutes: number;
  isDraft: boolean;
  lockedAt: string | null;
  internalCalendarEventId: string | null;
  externalCalendarSyncStatus: ExternalSyncStatus;
}

/**
 * Persist a meeting from the Meeting Edit Screen.
 *
 * Draft mode leaves the meeting unlocked and out of Upcoming Meetings / the
 * internal calendar. Saving (draft = false) locks the details, stamps a
 * native internal calendar event id, sets status to Scheduled (prep_needed),
 * and — only after the native meeting exists — computes the third-party sync
 * state. Third-party failures never block the native meeting.
 */
export async function saveScheduledMeeting(
  supabase: ServerClient,
  input: ScheduleMeetingInput,
): Promise<SavedScheduledMeeting> {
  const isDraft = input.draft === true;
  const now = new Date().toISOString();
  const duration = cleanDuration(input.durationMinutes);

  const externalStatus: ExternalSyncStatus = isDraft
    ? "not_connected"
    : nextExternalSyncStatus({
        enabled: !!input.externalCalendarSyncEnabled,
        providerConnected: !!input.externalCalendarProvider,
        isEdit: false,
        timingOrAttendeesChanged: false,
      });

  const shared = {
    title: input.title.trim() || "Meeting",
    organization_id: input.orgId,
    deal_id: input.dealId ?? null,
    description: input.description ?? null,
    location: input.location ?? null,
    meeting_url: input.meetingUrl ?? null,
    scheduled_at: input.scheduledAt,
    duration_minutes: duration,
    timezone: input.timezone.trim() || "UTC",
    meeting_type: input.meetingType.trim() || "internal_strategy",
    objective: input.objective ?? null,
    agenda: input.agenda ?? null,
    preparation_requirements: input.preparationRequirements ?? null,
    attendees: (input.attendees ?? []) as Json,
    attachments: (input.attachments ?? []) as Json,
    assigned_copilot_agent: input.assignedCopilotAgent ?? null,
    related_record_type: input.relatedRecordType ?? null,
    related_record_id: input.relatedRecordId ?? null,
    calendar_visibility: input.calendarVisibility ?? "organization",
    reminder_minutes: input.reminderMinutes ?? null,
    priority: input.priority ?? "normal",
    tags: cleanTags(input.tags),
    external_calendar_sync_enabled: !!input.externalCalendarSyncEnabled,
    external_calendar_provider: input.externalCalendarProvider ?? null,
    external_calendar_sync_status: externalStatus,
    is_draft: isDraft,
    preparation_status: isDraft ? "draft" : "prep_needed",
    followup_status: "not_started",
    source: "fundexecs",
    sync_status: "local_only",
  };

  let row: { id: string; room_code: string; scheduled_at: string | null; duration_minutes: number; locked_at: string | null; internal_calendar_event_id: string | null };

  if (input.meetingId) {
    // Saving an existing draft: lock it in place, minting the native calendar
    // event id on first save.
    const existing = await supabase
      .from("live_meetings")
      .select("id, internal_calendar_event_id, locked_at")
      .eq("id", input.meetingId)
      .eq("organization_id", input.orgId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("Meeting not found");

    const existingRow = existing.data as unknown as Pick<LiveMeeting, "id" | "internal_calendar_event_id" | "locked_at">;
    const internalId = isDraft
      ? existingRow.internal_calendar_event_id
      : existingRow.internal_calendar_event_id ?? crypto.randomUUID();
    const lockedAt = isDraft ? existingRow.locked_at : existingRow.locked_at ?? now;

    const { data, error } = await supabase
      .from("live_meetings")
      .update({
        ...shared,
        internal_calendar_event_id: internalId,
        locked_at: lockedAt,
      } as never)
      .eq("id", input.meetingId)
      .eq("organization_id", input.orgId)
      .select("id, room_code, scheduled_at, duration_minutes, locked_at, internal_calendar_event_id")
      .single();
    if (error) throw new Error(error.message);
    row = data;
  } else {
    const roomCode = generateRoomCode();
    const internalId = isDraft ? null : crypto.randomUUID();
    const { data, error } = await (supabase.from("live_meetings") as ReturnType<typeof supabase.from>)
      .insert({
        ...shared,
        room_code: roomCode,
        host_id: input.hostId,
        status: "waiting",
        internal_calendar_event_id: internalId,
        locked_at: isDraft ? null : now,
      } as never)
      .select("id, room_code, scheduled_at, duration_minutes, locked_at, internal_calendar_event_id")
      .single();
    if (error) throw new Error(error.message);
    row = data;
  }

  await writeDashboardAudit({
    organizationId: input.orgId,
    principalId: input.hostId,
    action: isDraft ? "meeting.saved_draft" : "meeting.scheduled",
    entityType: "live_meeting",
    entityId: row.id,
    afterState: {
      title: shared.title,
      scheduled_at: shared.scheduled_at,
      is_draft: isDraft,
      external_calendar_sync_status: externalStatus,
    } as Json,
  });

  return {
    id: row.id,
    roomCode: row.room_code,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes ?? duration,
    isDraft,
    lockedAt: row.locked_at,
    internalCalendarEventId: row.internal_calendar_event_id,
    externalCalendarSyncStatus: externalStatus,
  };
}

/**
 * Push a saved meeting onto the member's connected Google calendar.
 *
 * This used to mint a placeholder id and mark the meeting "synced" without
 * contacting anybody, so the UI reported a sync that had never happened. It now
 * performs the real write; the mapping and the create/update/delete decision
 * live in lib/calendar/google-write.ts.
 */
export async function syncMeetingExternal(
  supabase: ServerClient,
  actor: { orgId: string; userId: string },
  meetingId: string,
): Promise<{ ok: boolean; status: ExternalSyncStatus; error?: string }> {
  const before = await supabase
    .from("live_meetings")
    .select(
      "id, title, description, location, meeting_url, objective, agenda, scheduled_at, duration_minutes, timezone, calendar_visibility, reminder_minutes, attendees, is_draft, locked_at, deleted_at, external_calendar_provider, external_calendar_event_id, external_calendar_sync_enabled",
    )
    .eq("id", meetingId)
    .eq("organization_id", actor.orgId)
    .maybeSingle();
  if (before.error) throw new Error(before.error.message);
  if (!before.data) throw new Error("Meeting not found");

  const meeting = before.data as unknown as WritableMeeting & { is_draft: boolean | null; locked_at: string | null };

  // A meeting still being written has nothing worth publishing, and once guests
  // are attached a premature push lands in other people's inboxes.
  if (meeting.is_draft || !meeting.locked_at) {
    return { ok: false, status: "sync_pending", error: "Meeting must be saved before it can sync externally." };
  }

  const result = await pushMeetingToGoogle(supabase, meeting, actor.userId);

  await writeDashboardAudit({
    organizationId: actor.orgId,
    principalId: actor.userId,
    action: result.ok ? "meeting.external_synced" : "meeting.external_sync_failed",
    entityType: "live_meeting",
    entityId: meetingId,
    afterState: {
      external_calendar_event_id: result.eventId,
      external_calendar_sync_status: result.status,
      action: result.action,
    } as Json,
  });

  return result.ok
    ? { ok: true, status: result.status as ExternalSyncStatus }
    : { ok: false, status: result.status as ExternalSyncStatus, error: result.error };
}

export async function updateMeeting(
  supabase: ServerClient,
  actor: { orgId: string; userId: string },
  meetingId: string,
  input: UpdateMeetingInput,
): Promise<{ ok: true }> {
  const before = await supabase
    .from("live_meetings")
    .select("*")
    .eq("id", meetingId)
    .eq("organization_id", actor.orgId)
    .maybeSingle();
  if (before.error) throw new Error(before.error.message);
  if (!before.data) throw new Error("Meeting not found");

  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title.trim() || "Meeting";
  if (input.description !== undefined) update.description = input.description;
  if (input.location !== undefined) update.location = input.location;
  if (input.meetingUrl !== undefined) update.meeting_url = input.meetingUrl;
  if (input.scheduledAt !== undefined) update.scheduled_at = input.scheduledAt;
  if (input.durationMinutes !== undefined) update.duration_minutes = cleanDuration(input.durationMinutes);
  if (input.timezone !== undefined) update.timezone = input.timezone?.trim() || "UTC";
  if (input.meetingType !== undefined) update.meeting_type = input.meetingType?.trim() || "internal_strategy";
  if (input.priority !== undefined) update.priority = input.priority;
  if (input.tags !== undefined) update.tags = cleanTags(input.tags);
  if (input.attendees !== undefined) update.attendees = input.attendees as Json;
  if (input.relatedContactId !== undefined) update.related_contact_id = input.relatedContactId;
  if (input.relatedCompanyId !== undefined) update.related_company_id = input.relatedCompanyId;
  if (input.relatedDealId !== undefined) update.deal_id = input.relatedDealId;
  if (input.relatedFundId !== undefined) update.related_fund_id = input.relatedFundId;
  if (input.syncMode !== undefined) update.sync_status = input.syncMode === "pending_external" ? "pending_sync" : "local_only";
  if (input.objective !== undefined) update.objective = input.objective;
  if (input.agenda !== undefined) update.agenda = input.agenda;
  if (input.preparationRequirements !== undefined) update.preparation_requirements = input.preparationRequirements;
  if (input.attachments !== undefined) update.attachments = input.attachments as Json;
  if (input.calendarVisibility !== undefined) update.calendar_visibility = input.calendarVisibility;
  if (input.reminderMinutes !== undefined) update.reminder_minutes = input.reminderMinutes;
  if (input.assignedCopilotAgent !== undefined) update.assigned_copilot_agent = input.assignedCopilotAgent;
  if (input.relatedRecordType !== undefined) update.related_record_type = input.relatedRecordType;
  if (input.relatedRecordId !== undefined) update.related_record_id = input.relatedRecordId;
  if (input.externalCalendarProvider !== undefined) update.external_calendar_provider = input.externalCalendarProvider;

  // If a locked meeting's timing or attendees changed while a third-party sync
  // is enabled, the external mirror needs re-syncing. The native meeting stays
  // the source of truth regardless.
  const timingOrAttendeesChanged =
    input.scheduledAt !== undefined ||
    input.durationMinutes !== undefined ||
    input.attendees !== undefined;
  const before2 = before.data as unknown as LiveMeeting;
  const syncEnabled = input.externalCalendarSyncEnabled ?? before2.external_calendar_sync_enabled;
  if (input.externalCalendarSyncEnabled !== undefined) {
    update.external_calendar_sync_enabled = input.externalCalendarSyncEnabled;
  }
  if (before2.locked_at) {
    update.external_calendar_sync_status = nextExternalSyncStatus({
      enabled: !!syncEnabled,
      providerConnected: !!(input.externalCalendarProvider ?? before2.external_calendar_provider),
      currentStatus: (before2.external_calendar_sync_status as ExternalSyncStatus) ?? "not_connected",
      isEdit: true,
      timingOrAttendeesChanged,
    });
  }

  const { error } = await supabase
    .from("live_meetings")
    .update(update as never)
    .eq("id", meetingId)
    .eq("organization_id", actor.orgId);
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: actor.orgId,
    principalId: actor.userId,
    action: "meeting.updated",
    entityType: "live_meeting",
    entityId: meetingId,
    beforeState: before.data as Json,
    afterState: update as Json,
  });

  return { ok: true };
}

export async function deleteMeetingLocal(
  supabase: ServerClient,
  actor: { orgId: string; userId: string },
  meetingId: string,
): Promise<{ ok: true }> {
  const before = await supabase
    .from("live_meetings")
    .select("*")
    .eq("id", meetingId)
    .eq("organization_id", actor.orgId)
    .maybeSingle();
  if (before.error) throw new Error(before.error.message);
  if (!before.data) throw new Error("Meeting not found");

  const update = { deleted_at: new Date().toISOString(), sync_status: "deleted_local" };
  const { error } = await supabase
    .from("live_meetings")
    .update(update as never)
    .eq("id", meetingId)
    .eq("organization_id", actor.orgId);
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: actor.orgId,
    principalId: actor.userId,
    action: "meeting.deleted_local",
    entityType: "live_meeting",
    entityId: meetingId,
    beforeState: before.data as Json,
    afterState: update as Json,
  });

  return { ok: true };
}

export async function clearUpcomingMeetingsLocal(
  supabase: ServerClient,
  actor: { orgId: string; userId: string },
): Promise<{ ok: true; count: number }> {
  const now = new Date().toISOString();
  const before = await supabase
    .from("live_meetings")
    .select("id, title, scheduled_at, source, sync_status")
    .eq("organization_id", actor.orgId)
    .is("deleted_at", null)
    .neq("status", "ended")
    .gte("scheduled_at", now);
  if (before.error) throw new Error(before.error.message);

  const rows = before.data ?? [];
  const update = { deleted_at: now, sync_status: "deleted_local" };
  const { error } = await supabase
    .from("live_meetings")
    .update(update as never)
    .eq("organization_id", actor.orgId)
    .is("deleted_at", null)
    .neq("status", "ended")
    .gte("scheduled_at", now);
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: actor.orgId,
    principalId: actor.userId,
    action: "meeting.clear_upcoming_local",
    entityType: "live_meeting",
    beforeState: rows as Json,
    afterState: { count: rows.length, ...update } as Json,
  });

  return { ok: true, count: rows.length };
}

export async function markMeetingPendingSync(
  supabase: ServerClient,
  actor: { orgId: string; userId: string },
  meetingId: string,
): Promise<{ ok: true }> {
  const update = { sync_status: "pending_sync" };
  const { error } = await supabase
    .from("live_meetings")
    .update(update as never)
    .eq("id", meetingId)
    .eq("organization_id", actor.orgId);
  if (error) throw new Error(error.message);
  await writeDashboardAudit({
    organizationId: actor.orgId,
    principalId: actor.userId,
    action: "meeting.sync_requested",
    entityType: "live_meeting",
    entityId: meetingId,
    afterState: update,
  });
  return { ok: true };
}

export async function persistInstitutionalMeetingRecord(
  supabase: ServerClient,
  input: PersistMeetingRecordInput,
): Promise<void> {
  if (!input.meeting.organization_id) return;

  const snapshot = {
    summary: typeof input.analysis.summary === "string" ? input.analysis.summary : "",
    key_points: Array.isArray(input.analysis.key_points) ? input.analysis.key_points : [],
    action_items: Array.isArray(input.analysis.action_items) ? input.analysis.action_items : [],
    decisions: Array.isArray(input.analysis.decisions) ? input.analysis.decisions : [],
    follow_up_draft: typeof input.analysis.follow_up_draft === "string" ? input.analysis.follow_up_draft : "",
  };

  await Promise.allSettled([
    supabase.from("meeting_notes").insert({
      organization_id: input.meeting.organization_id,
      deal_id: input.meeting.deal_id ?? null,
      title: input.meeting.title ?? "Meeting",
      occurred_at: new Date().toISOString(),
      participants: input.participants ?? [],
      transcript: input.transcript,
      analysis: input.analysis as Json,
      created_by: input.actorId,
    } as never),
    supabase
      .from("live_meetings")
      .update({
        notes_snapshot: snapshot as Json,
        followup_status: input.analysis.follow_up_draft ? "draft" : "not_started",
      } as never)
      .eq("id", input.meeting.id),
  ]);
}
