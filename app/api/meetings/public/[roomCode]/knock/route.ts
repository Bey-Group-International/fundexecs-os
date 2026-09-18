import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { isRemoved, subjectFor } from "@/lib/meetings/removal";
import { shouldRecordPresence } from "@/lib/meetings/waiting-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Waiting-room "knock" for anyone joining a meeting who isn't the host — including
// unauthenticated invite-link guests, which is why this uses the service role
// (like the public room lookup) and is keyed by a client-generated guest_key
// rather than auth. Knocking is idempotent: an existing knock returns its current
// decision, so re-POSTs (and reconnects) never reset an admit/deny.

// Both halves of this endpoint are unauthenticated and reachable by anyone
// holding a room code — which is anyone a link was ever forwarded to. The
// ice-servers route beside this one has been bounded for a while; these two were
// not, and they are the pair that matter more.
//
// A knock INSERTS a row and puts a name in front of the host. The guest_key it
// is filed under is chosen by the client, so a caller can mint a new one per
// request and there is nothing in the row itself to collapse them: an
// unbounded POST is an unbounded waiting list, in a panel a host is trying to
// read during a live meeting, and an unbounded table behind it. Bounded hard,
// and still far above what a person does — one knock per join, plus the
// occasional re-knock, for everyone sharing an office NAT.
const KNOCK_LIMIT = 60;
const KNOCK_WINDOW_MS = 10 * 60_000;

// Polling only reads, so this is about load rather than about content — but it
// is the hottest endpoint in the meeting stack and it is paid per guest per
// tick. The ceiling is set well clear of what real guests generate: a waiting
// guest polls roughly 26 times in its first minute (1.5s, widening), or 4 with
// a live push, so this leaves room for a couple of dozen of them behind one
// address while still bounding a loop that would otherwise run flat out.
const POLL_LIMIT = 600;
const POLL_WINDOW_MS = 60_000;

/** A 429 that says when to come back, in the shape the rest of the API uses. */
function tooMany(result: ReturnType<typeof checkRateLimit>, limit: number) {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    { status: 429, headers: rateLimitHeaders(result, limit) },
  );
}

function client() {
  return hasSupabaseServiceEnv() ? createServiceClient() : null;
}

async function resolveMeeting(code: string) {
  const supabase = client() ?? (await createServerClient());
  const { data } = await supabase
    .from("live_meetings")
    .select("id, organization_id, status, guest_quick_access")
    .eq("room_code", code)
    .is("deleted_at", null)
    .maybeSingle();
  return {
    supabase,
    meeting: data as {
      id: string;
      organization_id: string | null;
      status: string;
      guest_quick_access: boolean | null;
    } | null,
  };
}

// Who the caller is, and whether they skip the waiting room.
//
// Two answers from one lookup, because this used to give only the second and
// throw the first away — and the account is the more important of the two. It is
// what makes a removal stick to a teammate (they can drop their guest key; they
// cannot drop their account), and it is what fills live_meeting_admissions.user_id,
// a column that has existed since the waiting room shipped and has been NULL on
// every row ever written.
//
// Membership is read with the service role (or the request client in local dev)
// to avoid RLS surprises, keyed by the user resolved from the request's auth
// cookies — never from anything the client sends.
async function identifyCaller(
  orgId: string | null,
  svc: SupabaseLike,
): Promise<{ userId: string | null; isOrgMember: boolean }> {
  const authed = await createServerClient();
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return { userId: null, isOrgMember: false };
  if (!orgId) return { userId: user.id, isOrgMember: false };
  const { data } = await (svc as SupabaseLike)
    .from("organization_members")
    .select("organization_id")
    .eq("principal_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return { userId: user.id, isOrgMember: !!data };
}

type SupabaseLike = { from: (table: string) => any };

/** A knock already on file, or null. The shape both callers below need. */
interface Knock { id: string; status: string; display_name: string }

async function readKnock(svc: SupabaseLike, meetingId: string, guestKey: string): Promise<Knock | null> {
  const { data } = await (svc as any)
    .from("live_meeting_admissions")
    .select("id, status, display_name")
    .eq("meeting_id", meetingId)
    .eq("guest_key", guestKey)
    .maybeSingle();
  return (data as Knock | null) ?? null;
}

/**
 * Everyone the host has removed from this meeting.
 *
 * Read on every knock, and read for BOTH identifiers the caller might be known
 * by, because either one is enough to refuse them and a removed teammate
 * arrives with a fresh guest key precisely when they are trying to get around
 * it. Two narrow indexed lookups on one meeting, not a scan.
 */
async function readRemovals(
  svc: SupabaseLike,
  meetingId: string,
): Promise<Array<{ user_id: string | null; guest_key: string | null }>> {
  const { data } = await (svc as any)
    .from("live_meeting_removals")
    .select("user_id, guest_key")
    .eq("meeting_id", meetingId);
  return (data ?? []) as Array<{ user_id: string | null; guest_key: string | null }>;
}

/**
 * The answer for a guest who already has a row.
 *
 * Returns the existing decision rather than clobbering it — but promotes anyone
 * who should not be waiting at all: a teammate whose client knocked before we
 * recognized them, or any guest on a meeting whose quick access was switched on
 * while they were already in the queue.
 */
async function answerKnock(
  svc: SupabaseLike,
  existing: Knock,
  admitOnSight: boolean,
  displayName: string,
  userId: string | null,
) {
  if (admitOnSight && existing.status === "waiting") {
    await (svc as any)
      .from("live_meeting_admissions")
      // The account goes on here too: a teammate whose first knock landed before
      // they had signed in, or whose row predates this column being written at
      // all, is a row a later removal would not be able to match.
      .update({ status: "admitted", decided_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) })
      .eq("id", existing.id);
    return NextResponse.json({ admissionId: existing.id, status: "admitted" });
  }
  // A guest whose knock is still pending may re-knock under a name they have
  // since corrected — they are keyed by guest_key now, not by a per-load id, so
  // the second knock lands on the same row. The host is deciding on a name, so
  // it should be the one the guest is currently offering. A decided row is left
  // exactly as it was: the decision was made about that name.
  if (existing.status === "waiting" && displayName !== existing.display_name) {
    await (svc as any)
      .from("live_meeting_admissions")
      .update({ display_name: displayName, ...(userId ? { user_id: userId } : {}) })
      .eq("id", existing.id);
  }
  return NextResponse.json({ admissionId: existing.id, status: existing.status });
}

/** Postgres unique_violation — here, always UNIQUE (meeting_id, guest_key). */
const UNIQUE_VIOLATION = "23505";

// POST — record (or look up) this guest's knock. Returns the current status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  // Before any database work: a limiter that only bites after the insert would
  // be bounding the response rather than the damage.
  const limit = checkRateLimit({ key: `knock:${clientIp(req)}`, limit: KNOCK_LIMIT, windowMs: KNOCK_WINDOW_MS });
  if (!limit.ok) return tooMany(limit, KNOCK_LIMIT);

  const { roomCode } = await params;
  const code = roomCode?.trim();
  if (!code) return NextResponse.json({ error: "Missing room code" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { guestKey?: string; displayName?: string };
  const guestKey = typeof body.guestKey === "string" ? body.guestKey.trim() : "";
  const displayName = (typeof body.displayName === "string" && body.displayName.trim()) || "Guest";
  if (!guestKey) return NextResponse.json({ error: "guestKey required" }, { status: 400 });

  const { supabase, meeting } = await resolveMeeting(code);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.status === "ended") return NextResponse.json({ status: "ended" });

  // Org teammates are auto-admitted; only external guests actually wait.
  //
  // ...unless the host turned quick access on for this meeting, in which case
  // holding the link is the whole check and nobody waits. Read off the meeting
  // row rather than trusted from the request: the client that knocks is the
  // guest's, and a guest must never be able to admit themselves.
  //
  // The teammate check and the existing-knock read answer different questions
  // and neither needs the other's answer, so they go together. Run in sequence
  // they were two round trips deep in the one request a guest is actively
  // waiting on — and for a signed-in caller the teammate check is itself two,
  // since it resolves the user before it can look up their membership. Quick
  // access skips the check entirely rather than racing it: the answer cannot
  // change the outcome, so asking for it would be a round trip spent on nothing.
  const quickAccess = meeting.guest_quick_access === true;
  // The caller is identified even under quick access, which the membership
  // check used to be skipped for. Quick access decides whether anybody WAITS;
  // it says nothing about who the caller is, and the removal check below needs
  // to know — a host who removed a teammate from a quick-access meeting would
  // otherwise have removed them for as long as it took them to press reload.
  const [caller, existing, removals] = await Promise.all([
    identifyCaller(meeting.organization_id, supabase),
    readKnock(supabase, meeting.id, guestKey),
    readRemovals(supabase, meeting.id),
  ]);

  // Ahead of every other answer, including quick access and membership.
  //
  // Those two are the reasons somebody skips the queue, and a removal is the
  // host saying this particular person does not come in — so it has to be read
  // before them, not after. Checked against the account the SERVER resolved
  // from the request's cookies, never against anything the body claimed: a
  // removed teammate who clears their site data arrives with a brand new guest
  // key and the same account, and it is the account that stops them.
  const subject = subjectFor(caller.userId, guestKey);
  if (isRemoved(removals, subject)) {
    return NextResponse.json({ status: "denied" });
  }

  const admitOnSight = quickAccess || caller.isOrgMember;
  if (existing) return answerKnock(supabase, existing, admitOnSight, displayName, caller.userId);

  const { data: inserted, error } = await (supabase as any)
    .from("live_meeting_admissions")
    .insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      guest_key: guestKey,
      // The column that has been NULL on every row ever written. Without it the
      // one table that knows a signed-in person knocked cannot say who, and a
      // removal keyed on the account has nothing to match.
      user_id: caller.userId,
      display_name: displayName,
      status: admitOnSight ? "admitted" : "waiting",
      ...(admitOnSight ? { decided_at: new Date().toISOString() } : {}),
    })
    .select("id, status")
    .maybeSingle();
  if (inserted) {
    return NextResponse.json({ admissionId: inserted.id as string, status: inserted.status as string });
  }

  // Read-then-insert is not atomic, and this endpoint is called concurrently by
  // design: the guest's first knock races the re-knock their poll fires when the
  // server has no record of them, and two tabs or a double press do the same.
  // The loser hits UNIQUE (meeting_id, guest_key) — which is the constraint
  // doing its job, not a failure. Answering it with a 500 made the one operation
  // documented as idempotent fail precisely when it was repeated.
  //
  // So re-read and answer from the row that won, through the same path as a knock
  // that was already on file. That keeps the outcome identical whichever way the
  // race went, including the promotion a teammate is owed.
  if ((error as { code?: string } | null)?.code === UNIQUE_VIOLATION) {
    const winner = await readKnock(supabase, meeting.id, guestKey);
    if (winner) return answerKnock(supabase, winner, admitOnSight, displayName, caller.userId);
  }
  return NextResponse.json({ error: "Could not knock" }, { status: 500 });
}

// GET ?key=<guestKey> — poll the decision. Guests can't use RLS/Realtime, so they
// poll this while on the waiting screen.
//
// This is the hottest endpoint in the meeting stack: every waiting guest hits it
// on a timer for as long as they wait, so its cost is paid per guest per tick.
// It used to resolve the meeting and then read the admission — two sequential
// round trips to Postgres, the second waiting on the first for nothing but an id.
//
// One query answers both. The admission row is fetched with its meeting joined
// (`!inner`, so a soft-deleted or mismatched meeting yields no row at all), which
// covers every poll where the guest actually has a knock on file — that is, all
// of them but the first tick and the rare repair case. Only when that comes back
// empty do we spend a second query, and then only to tell "no such meeting" (404,
// stop) apart from "no knock recorded" ("unknown", re-knock) — a distinction the
// client acts on, so it has to be exact.
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const limit = checkRateLimit({ key: `knock-poll:${clientIp(req)}`, limit: POLL_LIMIT, windowMs: POLL_WINDOW_MS });
  if (!limit.ok) return tooMany(limit, POLL_LIMIT);

  const { roomCode } = await params;
  const code = roomCode?.trim();
  const guestKey = req.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!code || !guestKey) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const supabase = client() ?? (await createServerClient());

  const { data: joined } = await (supabase as any)
    .from("live_meeting_admissions")
    .select("id, status, last_seen_at, live_meetings!inner(status, room_code, deleted_at)")
    .eq("guest_key", guestKey)
    .eq("live_meetings.room_code", code)
    .is("live_meetings.deleted_at", null)
    .maybeSingle();

  if (joined) {
    // A to-one embed comes back as an object, but normalise anyway: if this ever
    // arrived as a one-element array the `ended` check would silently never fire,
    // and a guest would poll a finished meeting until the timeout.
    const embed = (joined as { live_meetings?: unknown }).live_meetings;
    const meeting = (Array.isArray(embed) ? embed[0] : embed) as { status?: string } | undefined;
    if (meeting?.status === "ended") return NextResponse.json({ status: "ended" });

    const row = joined as { id: string; status: string; last_seen_at?: string | null };

    // This poll is the only proof anybody has that a waiting guest is still
    // there. A `waiting` row is cleared by a decision and by nothing else, so
    // until this was written down a guest who knocked and closed the tab stayed
    // in the host's panel for the rest of the meeting — chiming, badging the
    // tab title, and ending with the host admitting somebody who is not there.
    //
    // Throttled, and only for a guest who is actually waiting. This is the
    // hottest endpoint in the meeting stack: writing on every tick would be an
    // UPDATE every second and a half per waiting guest, and — because this
    // table is published to Realtime and the host subscribes to `*` on it — a
    // list re-apply and a coalesced re-read on the host's screen at the same
    // rate. See PRESENCE_WRITE_MS.
    //
    // Fire-and-forget: the answer above does not depend on it, and a guest must
    // never wait on our bookkeeping to hear their decision.
    if (row.status === "waiting" && shouldRecordPresence(row.last_seen_at, Date.now())) {
      void (supabase as any)
        .from("live_meeting_admissions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", row.id)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.warn("[knock] presence not recorded", error.message);
        });
    }

    return NextResponse.json({ status: row.status });
  }

  // No knock on file for this key. Say which kind of nothing it is.
  const { meeting } = await resolveMeeting(code);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.status === "ended") return NextResponse.json({ status: "ended" });
  return NextResponse.json({ status: "unknown" });
}

// DELETE ?key=<guestKey> — withdraw a knock that is still waiting.
//
// A guest who gave up used to leave their row behind forever. Cancelling the
// wait touched nothing on the server, there is no TTL on the table and nothing
// sweeps it, so the host went on seeing somebody who had left: in the panel, in
// the toolbar count, and in the system notification that fires when that count
// rises. Admitting them reached nobody, and the only way to clear the entry was
// to deny a person who was no longer there.
//
// Only a WAITING row is removed, and this is why it deletes rather than marking
// a new status: the host's panel already drops a row on a DELETE event
// (applyAdmissionChange), and a guest who comes back simply knocks again. A
// decided row is left exactly as it is — an admit is what the transcript route
// checks a guest's own writes against, and a deny is a decision that a withdraw
// must not be able to erase.
//
// Unauthenticated like the rest of this endpoint, and keyed by the same
// guest_key: withdrawing is only ever destructive to the caller's own pending
// knock, and anyone holding a key already controls that knock completely.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
  const limit = checkRateLimit({ key: `knock:${clientIp(req)}`, limit: KNOCK_LIMIT, windowMs: KNOCK_WINDOW_MS });
  if (!limit.ok) return tooMany(limit, KNOCK_LIMIT);

  const { roomCode } = await params;
  const code = roomCode?.trim();
  const guestKey = req.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!code || !guestKey) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { supabase, meeting } = await resolveMeeting(code);
  // Nothing to withdraw from, and nothing a guest can do about it. Not an error
  // worth surfacing on a screen they are leaving anyway.
  if (!meeting) return NextResponse.json({ ok: true, withdrawn: 0 });

  const { data: removed, error } = await (supabase as any)
    .from("live_meeting_admissions")
    .delete()
    .eq("meeting_id", meeting.id)
    .eq("guest_key", guestKey)
    .eq("status", "waiting")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, withdrawn: ((removed ?? []) as unknown[]).length });
}
