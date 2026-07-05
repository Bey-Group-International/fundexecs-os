import type { createServerClient } from "@/lib/supabase/server";
import type { Json, LiveMeeting } from "@/lib/supabase/database.types";
import { writeDashboardAudit } from "@/lib/dashboard/audit";

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
