import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Waiting-room "knock" for anyone joining a meeting who isn't the host — including
// unauthenticated invite-link guests, which is why this uses the service role
// (like the public room lookup) and is keyed by a client-generated guest_key
// rather than auth. Knocking is idempotent: an existing knock returns its current
// decision, so re-POSTs (and reconnects) never reset an admit/deny.

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

// Teammate check: is the (signed-in) caller a member of the meeting's org? If so
// they skip the waiting room — only external guests wait. Membership is read with
// the service role (or the request client in local dev) to avoid RLS surprises,
// keyed by the user resolved from the request's auth cookies.
async function callerIsOrgMember(orgId: string | null, svc: SupabaseLike): Promise<boolean> {
  if (!orgId) return false;
  const authed = await createServerClient();
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return false;
  const { data } = await (svc as SupabaseLike)
    .from("organization_members")
    .select("organization_id")
    .eq("principal_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return !!data;
}

type SupabaseLike = { from: (table: string) => any };

// POST — record (or look up) this guest's knock. Returns the current status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomCode: string }> }) {
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
  const quickAccess = meeting.guest_quick_access === true;
  const admitOnSight = quickAccess || (await callerIsOrgMember(meeting.organization_id, supabase));

  // Return the existing decision rather than clobbering it — but promote anyone
  // who should not be waiting at all: a teammate whose client knocked before we
  // recognized them, or any guest on a meeting whose quick access was switched
  // on while they were already in the queue.
  const { data: existing } = await (supabase as any)
    .from("live_meeting_admissions")
    .select("id, status, display_name")
    .eq("meeting_id", meeting.id)
    .eq("guest_key", guestKey)
    .maybeSingle();
  if (existing) {
    if (admitOnSight && existing.status === "waiting") {
      await (supabase as any)
        .from("live_meeting_admissions")
        .update({ status: "admitted", decided_at: new Date().toISOString() })
        .eq("id", existing.id);
      return NextResponse.json({ admissionId: existing.id as string, status: "admitted" });
    }
    // A guest whose knock is still pending may re-knock under a name they have
    // since corrected — they are keyed by guest_key now, not by a per-load id, so
    // the second knock lands on the same row. The host is deciding on a name, so
    // it should be the one the guest is currently offering. A decided row is left
    // exactly as it was: the decision was made about that name.
    if (existing.status === "waiting" && displayName !== existing.display_name) {
      await (supabase as any)
        .from("live_meeting_admissions")
        .update({ display_name: displayName })
        .eq("id", existing.id);
    }
    return NextResponse.json({ admissionId: existing.id as string, status: existing.status as string });
  }

  const { data: inserted, error } = await (supabase as any)
    .from("live_meeting_admissions")
    .insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      guest_key: guestKey,
      display_name: displayName,
      status: admitOnSight ? "admitted" : "waiting",
      ...(admitOnSight ? { decided_at: new Date().toISOString() } : {}),
    })
    .select("id, status")
    .maybeSingle();
  if (error || !inserted) return NextResponse.json({ error: "Could not knock" }, { status: 500 });
  return NextResponse.json({ admissionId: inserted.id as string, status: inserted.status as string });
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
  const { roomCode } = await params;
  const code = roomCode?.trim();
  const guestKey = req.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!code || !guestKey) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const supabase = client() ?? (await createServerClient());

  const { data: joined } = await (supabase as any)
    .from("live_meeting_admissions")
    .select("status, live_meetings!inner(status, room_code, deleted_at)")
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
    return NextResponse.json({ status: (joined as { status: string }).status });
  }

  // No knock on file for this key. Say which kind of nothing it is.
  const { meeting } = await resolveMeeting(code);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (meeting.status === "ended") return NextResponse.json({ status: "ended" });
  return NextResponse.json({ status: "unknown" });
}
