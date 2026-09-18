// lib/meetings/meeting-access.server.ts
// Who is asking, and are they in this meeting.
//
// Extracted because it is now needed in a third place. The rule cannot be RLS,
// and that is the whole point: an invite-link GUEST has no session for a policy
// to read, so every policy keyed on `auth.uid()` rejects them silently — a
// failure mode that looks exactly like nothing happening. So the routes that
// serve a live room decide for themselves, and write through the service role
// once they have.
//
// Three copies of this rule drifting apart is how a guest ends up able to write
// a transcript line and not a chat message, or the reverse, with nobody able to
// say which was intended.
import type { NextRequest } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// The real client's generics do not survive a structural stand-in, and the
// narrower shapes tried here all failed against it.
type SupabaseLike = { from: (table: string) => any };

export interface MeetingCaller {
  ok: boolean;
  /** The signed-in account, or null for an admitted guest. */
  userId: string | null;
}

const DENIED: MeetingCaller = { ok: false, userId: null };

/**
 * Decide whether this request may act inside a meeting.
 *
 * Two doors. A signed-in member — the host, somebody with a participant row,
 * or a member of the meeting's organization — or a guest the host has already
 * admitted, identified by the guest key in the query string.
 *
 * The organization case matters more than it looks: a teammate walks into the
 * room without knocking, and their participant row is written by a different
 * path that may not have landed when their first write goes out.
 */
export async function authorizeMeetingCaller(
  req: NextRequest,
  meetingId: string,
): Promise<MeetingCaller> {
  const authed = await createServerClient();
  const { data: { user } } = await authed.auth.getUser();
  const svc: SupabaseLike = hasSupabaseServiceEnv() ? createServiceClient() : (authed as SupabaseLike);

  if (user) {
    const { data } = await svc
      .from("live_meetings")
      .select("id, host_id, organization_id")
      .eq("id", meetingId)
      .is("deleted_at", null)
      .maybeSingle();
    const meeting = data as { id: string; host_id: string | null; organization_id: string | null } | null;
    if (!meeting) return DENIED;
    if (meeting.host_id === user.id) return { ok: true, userId: user.id };

    const { data: participant } = await svc
      .from("live_meeting_participants")
      .select("id")
      .eq("meeting_id", meetingId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (participant) return { ok: true, userId: user.id };

    if (meeting.organization_id) {
      const { data: member } = await svc
        .from("organization_members")
        .select("id")
        .eq("organization_id", meeting.organization_id)
        .eq("principal_id", user.id)
        .maybeSingle();
      if (member) return { ok: true, userId: user.id };
    }
    return DENIED;
  }

  const guestKey = req.nextUrl.searchParams.get("guestKey")?.trim() ?? "";
  if (!guestKey) return DENIED;

  const { data: admission } = await svc
    .from("live_meeting_admissions")
    .select("id, live_meetings!inner(id, status, deleted_at)")
    .eq("guest_key", guestKey)
    .eq("status", "admitted")
    .eq("meeting_id", meetingId)
    .is("live_meetings.deleted_at", null)
    .maybeSingle();

  return admission ? { ok: true, userId: null } : DENIED;
}
