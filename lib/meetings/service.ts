import type { createServerClient } from "@/lib/supabase/server";
import type { Json, LiveMeeting } from "@/lib/supabase/database.types";

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
