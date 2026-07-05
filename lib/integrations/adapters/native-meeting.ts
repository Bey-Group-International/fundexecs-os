// lib/integrations/adapters/native-meeting.ts
// Native meeting room dispatch — generates a FundExecs /meeting-room link
// instead of routing to an external scheduling service.
//
// Always live: no external credentials required. A room code is generated
// deterministically, the live_meetings row is persisted when ctx.supabase is
// available (so the room is ready before anyone navigates to it), and the link
// is returned as the DispatchResult.reference for the operator to share.
//
// The room is also created on first join if the pre-persist step is skipped
// (i.e. no supabase in context), so the link is always safe to share.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";
import { getAppUrl } from "./app-url";
import { buildMeetingInviteUrl, generateRoomCode } from "@/lib/meetings/service";

export const nativeMeetingAdapter: DispatchAdapter = {
  channel: "native_meeting",
  isConfigured: () => true,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
    const topic = ctx.subject ?? (ctx.metadata?.["stepTitle"] as string | undefined) ?? "Meeting";
    const roomCode = generateRoomCode();
    const meetingUrl = buildMeetingInviteUrl(getAppUrl(), roomCode);
    const scheduledAt = typeof ctx.metadata?.["scheduledAt"] === "string" ? ctx.metadata["scheduledAt"] : null;

    // Pre-persist the meeting row so the room is in "waiting" state before
    // the link is shared. Non-fatal if this fails — the room page creates it
    // on first join.
    if (ctx.supabase) {
      try {
        await (ctx.supabase.from("live_meetings") as ReturnType<typeof ctx.supabase.from>).upsert(
          {
            room_code: roomCode,
            title: topic,
            host_id: ctx.actorId !== "system" ? ctx.actorId : null,
            organization_id: ctx.orgId,
            status: "waiting",
            scheduled_at: scheduledAt,
            duration_minutes: 60,
            timezone: "UTC",
            meeting_type: "internal_strategy",
            preparation_status: scheduledAt ? "prep_needed" : "ready",
            followup_status: "not_started",
          },
          { onConflict: "room_code", ignoreDuplicates: false },
        );
      } catch {
        // Non-fatal.
      }
    }

    return {
      ok: true,
      channel: "native_meeting",
      live: true,
      detail: `Meeting room ready for "${topic}" with ${target}. Share the link below to invite them.`,
      reference: meetingUrl,
    };
  },
};

export const nativeMeetingModule: AdapterModule = {
  handles: ["propose_meeting", "confirm_booking"],
  adapter: nativeMeetingAdapter,
};
