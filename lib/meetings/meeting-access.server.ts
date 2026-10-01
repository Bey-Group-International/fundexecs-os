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

    // Either one lets them in, so both are asked at once. This runs before every
    // transcript flush and chat message, and asking them in turn made a
    // teammate who is not the host wait on both round trips every time.
    const [{ data: participant }, memberResult] = await Promise.all([
      svc
        .from("live_meeting_participants")
        .select("id")
        .eq("meeting_id", meetingId)
        .eq("user_id", user.id)
        .maybeSingle(),
      meeting.organization_id
        ? svc
            .from("organization_members")
            .select("id")
            .eq("organization_id", meeting.organization_id)
            .eq("principal_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (participant || memberResult.data) return { ok: true, userId: user.id };
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

/** A caller who is a signed-in member of the meeting's organization. */
export interface MeetingMember {
  ok: boolean;
  /** The signed-in account. Never null when `ok`. */
  userId: string | null;
  /** The meeting's organization. Never null when `ok`. */
  orgId: string | null;
  /** Whether they are the meeting's host, as opposed to a colleague in the room. */
  isHost: boolean;
}

const NOT_A_MEMBER: MeetingMember = { ok: false, userId: null, orgId: null, isHost: false };

/**
 * Decide whether this request may act on the ORGANIZATION'S OWN ASSETS from
 * inside a meeting.
 *
 * Strictly narrower than `authorizeMeetingCaller`, and the gap is the point.
 * That function answers "may you take part in this call", which is true of an
 * admitted guest with no account and of an outside participant. This one
 * answers "may you reach into the firm's data room and hand a document out",
 * which is true of neither:
 *
 *   a GUEST has no account at all, so there is no membership to check and
 *   nothing that could make them a member -- they are the person being shared
 *   WITH;
 *
 *   a PARTICIPANT ROW is not membership. A co-investor's analyst invited into
 *   one call has a participant row, and that must not become the ability to
 *   mint links to the firm's materials.
 *
 * So the one accepted door is: signed in, and either the meeting's host or a
 * member of the organization that owns the meeting. The organization id is
 * returned rather than left to the caller to re-read, because every caller
 * needs it to scope its own reads and a second read is a second chance to
 * scope them to a different org.
 *
 * This still establishes only WHO is asking. Whether they may WRITE is left to
 * the row-level policies on the caller's own client -- `is_org_writer` for a
 * share -- so a reader-role member is refused there rather than by a second
 * copy of the role rules here.
 */
export async function authorizeMeetingMember(
  meetingId: string,
): Promise<MeetingMember> {
  const authed = await createServerClient();
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return NOT_A_MEMBER;

  const svc: SupabaseLike = hasSupabaseServiceEnv() ? createServiceClient() : (authed as SupabaseLike);

  const { data } = await svc
    .from("live_meetings")
    .select("id, host_id, organization_id")
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  const meeting = data as { id: string; host_id: string | null; organization_id: string | null } | null;
  if (!meeting || !meeting.organization_id) return NOT_A_MEMBER;

  const isHost = meeting.host_id === user.id;

  // The host is let in without the membership read, as elsewhere -- but the
  // organization still has to be the one on the meeting, because that is what
  // scopes every read the caller goes on to make.
  if (isHost) return { ok: true, userId: user.id, orgId: meeting.organization_id, isHost: true };

  const { data: member } = await svc
    .from("organization_members")
    .select("id")
    .eq("organization_id", meeting.organization_id)
    .eq("principal_id", user.id)
    .maybeSingle();

  return member
    ? { ok: true, userId: user.id, orgId: meeting.organization_id, isHost: false }
    : NOT_A_MEMBER;
}
