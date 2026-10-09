import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { attendanceRecord, participantConflictTarget } from "@/lib/meetings/attendance";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record that an invite-link GUEST is in a meeting, or has left it.
 *
 * This exists because the client could not do it, for exactly the reason the
 * transcript route exists. `live_meeting_participants` has one policy --
 * `FOR ALL USING (user_id = auth.uid())` -- and a guest has no session, so both
 * sides are NULL. `NULL = NULL` is NULL rather than true, so every guest insert
 * was denied, silently, by a policy that cannot fail loudly. The room's join
 * path did not even attempt it: it wrote a row only `if (user)`.
 *
 * The cost of that was not cosmetic: the host's head-count did not include
 * them, the report's attendance list could only say "cannot tell" about an
 * invitee who had joined by link, and the summary email had nobody to write
 * to for an instant meeting.
 *
 * What this row does NOT do is open the report to the guest. The
 * `live_meeting_reports` policy matches participants by `user_id =
 * auth.uid()`, and a guest row has neither — so the guest reads the report
 * through the signed link the thank-you screen mints for their key instead
 * (app/api/meetings/public/[roomCode]/report-link). The row written here is
 * how that route knows the guest was in the room.
 *
 * MEMBERS ARE DELIBERATELY NOT ROUTED THROUGH HERE, and the asymmetry is the
 * point rather than an oversight. The existing policy expresses the member rule
 * exactly -- you may write your own row -- so a member's client write already
 * works, and `authorizeMeetingCaller` is STRICTER than that policy: it admits a
 * signed-in caller only as the host, an existing participant, or an org member.
 * A signed-in outside participant joining their first call is none of those, so
 * routing members here would deny the very first write each of them makes. The
 * rule RLS can express stays in RLS; this covers only the rule it cannot.
 *
 * So the one door this opens is the one `authorizeMeetingCaller` already
 * guards for transcripts, chat and ICE: a guest whose admission row the host
 * marked `admitted`, identified by the guest key in the query string. Knowing a
 * room code is not enough, and is not an identity Postgres could have checked
 * either -- which is why this is a route and not a policy.
 */

/** A join writes once and a departure once; a reload costs two. Generous. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/** As long as a display name is allowed to be anywhere else in the room. */
const MAX_NAME = 120;

type Params = Promise<{ id: string }>;
type SupabaseLike = { from: (table: string) => any };

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const limit = checkRateLimit({
    key: `meeting-attendance:${clientIp(req)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(limit, RATE_LIMIT) },
    );
  }

  const { id } = await params;
  const caller = await authorizeMeetingCaller(req, id);
  // The same answer whether the meeting does not exist or the caller has no
  // business with it: this is not a way to discover which meeting ids are real.
  if (!caller.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A signed-in caller writes their own row directly, under the policy that
  // already permits it. Accepting them here would mean two paths to the same
  // row, and the stricter authorization above would refuse some of the members
  // the policy allows -- see the note on asymmetry at the top of this file.
  if (caller.userId) {
    return NextResponse.json({ error: "Members record their own attendance" }, { status: 400 });
  }

  // Taken from the query string, not the body, because that is where
  // `authorizeMeetingCaller` read it: the key that was ADMITTED is the only key
  // this may write. Reading a second copy out of the body would let a guest be
  // admitted under one key and recorded under another -- somebody else's.
  const guestKey = req.nextUrl.searchParams.get("guestKey")?.trim() ?? "";
  if (!guestKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { displayName?: unknown; left?: unknown };

  const write: SupabaseLike = hasSupabaseServiceEnv()
    ? createServiceClient()
    : ((await createServerClient()) as SupabaseLike);

  if (body.left === true) {
    // Matched on the pair, never on the key alone: a guest key is scoped to one
    // room by `guestKeyStorageKey`, but nothing stops the same value reaching
    // this route with a different meeting id, and a departure that ignored the
    // meeting would mark somebody absent from a call they are still in.
    const { error } = await write
      .from("live_meeting_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("meeting_id", id)
      .eq("guest_key", guestKey)
      .is("left_at", null);

    if (error) {
      console.error("[/api/meetings/[id]/attendance] departure", error.message);
      return NextResponse.json({ error: "Failed to record departure" }, { status: 500 });
    }
    return NextResponse.json({ left: true });
  }

  const name = typeof body.displayName === "string" ? body.displayName.slice(0, MAX_NAME) : "";
  const row = attendanceRecord(id, { kind: "guest", guestKey }, name);

  const { error } = await write
    .from("live_meeting_participants")
    .upsert(row, { onConflict: participantConflictTarget({ kind: "guest", guestKey }) });

  if (error) {
    // Reported as a failure rather than swallowed. This is the write whose
    // silent refusal was the whole bug: a 200 here would restore the exact
    // condition -- a guest who believes they are recorded and is not.
    console.error("[/api/meetings/[id]/attendance] join", error.message);
    return NextResponse.json({ error: "Failed to record attendance" }, { status: 500 });
  }

  return NextResponse.json({ recorded: true });
}
