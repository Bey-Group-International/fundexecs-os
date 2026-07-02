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

function generateRoomCode(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 10; i++) {
    if (i === 3 || i === 7) { code += "-"; continue; }
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  try {
    const { hostname } = new URL(raw);
    const safe =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".fundexecs.com") ||
      hostname.endsWith(".vercel.app");
    return safe ? raw.replace(/\/$/, "") : "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}

export const nativeMeetingAdapter: DispatchAdapter = {
  channel: "native_meeting",
  isConfigured: () => true,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
    const topic = ctx.subject ?? (ctx.metadata?.["stepTitle"] as string | undefined) ?? "Meeting";
    const roomCode = generateRoomCode();
    const meetingUrl = `${getAppUrl()}/meeting-room/${roomCode}`;

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
