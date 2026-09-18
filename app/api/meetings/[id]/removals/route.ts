// app/api/meetings/[id]/removals/route.ts
// The host removing somebody from a live meeting.
//
// Removal used to be a message. The host's client broadcast
// `{type:"kick", target}` on the signalling channel and closed its own peer
// connection, and nothing else happened anywhere: no row, no server involved,
// no check on the way back in. So the person was removed from the host's grid
// and from nowhere else — still connected to every other participant, and one
// reload away from being back on the host's screen too.
//
// This is where a removal becomes a fact. It writes the row, shuts the door the
// person came in through, and nudges the room so the other participants drop
// them now rather than at some later reload.
//
// Host-only, verified here rather than trusted from the client, and written
// with the service role — the same shape as the admissions route beside it,
// because it is the same authority being exercised.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { nudgeGuests, nudgeRoom } from "@/lib/meetings/admission-broadcast";
import { subjectColumns, subjectFor, type RemovalSubject } from "@/lib/meetings/removal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The longest a display name is kept against a removal. */
const MAX_NAME = 80;

type Params = Promise<{ id: string }>;
type SupabaseLike = { from: (table: string) => any };

/**
 * Whose tile this is, according to the server.
 *
 * The host's screen knows a participant only as a signalling id — a fresh uuid
 * per page load — so something has to turn that into a durable identity. The
 * first version of this route had each peer ANNOUNCE its own subject over the
 * signalling channel and took the host's word for it, which was wrong: that
 * channel is publishable by anyone holding the room code, so a participant
 * could announce somebody ELSE'S subject, watch the host remove the tile in
 * front of them, and have the service role ban the victim instead.
 *
 * The knock is where the server already learns who somebody is, and it records
 * the signalling id they are about to join under. So the answer comes from a
 * row the server wrote, and a client that lies can only make its own tile
 * unresolvable — which costs it the call, because the kick still lands.
 */
async function subjectOfTile(
  svc: SupabaseLike,
  meetingId: string,
  signalId: string,
): Promise<{ subject: RemovalSubject | null; displayName: string }> {
  const { data } = await (svc as any)
    .from("live_meeting_admissions")
    .select("user_id, guest_key, display_name")
    .eq("meeting_id", meetingId)
    .eq("signal_id", signalId)
    .maybeSingle();
  const row = data as { user_id: string | null; guest_key: string | null; display_name: string } | null;
  if (!row) return { subject: null, displayName: "" };
  return { subject: subjectFor(row.user_id, row.guest_key), displayName: row.display_name ?? "" };
}

/**
 * Remove one person from this meeting, durably.
 *
 * The subject comes from the body because the host's screen is the only place
 * that knows which peer tile was clicked — a signalling id means nothing to the
 * server, so the room announces a durable subject alongside it. That is a claim
 * by the peer about itself, exactly as its display name already is; what makes
 * the removal sound is the other end, where a returning caller is matched
 * against their OWN authenticated account rather than against anything they
 * send.
 */
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { signalId?: unknown };
  const signalId = typeof body.signalId === "string" ? body.signalId.trim() : "";
  if (!signalId) {
    return NextResponse.json({ error: "signalId required" }, { status: 400 });
  }

  const rls = await createServerClient();
  const { data } = await rls
    .from("live_meetings")
    .select("id, host_id, room_code, organization_id")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  const meeting = data as
    | { id: string; host_id: string | null; room_code: string; organization_id: string | null }
    | null;
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the host can remove someone" }, { status: 403 });
  }
  const write: SupabaseLike = hasSupabaseServiceEnv()
    ? (createServiceClient() as SupabaseLike)
    : (rls as SupabaseLike);

  const { subject, displayName } = await subjectOfTile(write, meeting.id, signalId);
  if (!subject) {
    // No knock recorded under that signalling id. The kick has already gone out
    // over the channel, so the person is out of the call; what cannot be done
    // is keep them out, and saying so is better than writing a removal against
    // a guess.
    return NextResponse.json({ error: "That participant cannot be identified" }, { status: 404 });
  }
  // A host removing themselves would lock the meeting's owner out of their own
  // room, and the door they would then be refused at is the one they control.
  if (subject.kind === "member" && subject.userId === auth.ctx.userId) {
    return NextResponse.json({ error: "The host cannot remove themselves" }, { status: 400 });
  }

  const name = displayName.trim().slice(0, MAX_NAME);

  const columns = subjectColumns(subject);
  const { error } = await (write as any).from("live_meeting_removals").upsert(
    {
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      ...columns,
      display_name: name || "Guest",
      removed_by: auth.ctx.userId,
      removed_at: new Date().toISOString(),
    },
    // Removing the same person twice is one removal, and the second press must
    // not 409 at a host who is not sure the first one took.
    { onConflict: subject.kind === "member" ? "meeting_id,user_id" : "meeting_id,guest_key" },
  );

  if (error) {
    // Unlike a nudge, this one IS the operation. A host told the removal
    // succeeded when no row was written would believe somebody was out of the
    // room who is still in it, which is the defect this route exists to fix.
    console.error("[/api/meetings/[id]/removals] could not record removal", error.message);
    return NextResponse.json({ error: "Could not remove them" }, { status: 500 });
  }

  // Shut the door they came in through as well as recording the removal. The
  // knock route refuses a removed subject on its own, so this is belt and
  // braces — but it is also what turns the guest's own poll into the message
  // that they were removed, without inventing a second channel to say so.
  const { data: denied } = await (write as any)
    .from("live_meeting_admissions")
    .update({ status: "denied", decided_at: new Date().toISOString(), decided_by: auth.ctx.userId })
    .eq("meeting_id", meeting.id)
    .match(subject.kind === "member" ? { user_id: subject.userId } : { guest_key: subject.guestKey })
    .select("guest_key");

  const guestKeys = ((denied ?? []) as Array<{ guest_key: string }>).map((r) => r.guest_key);

  // Both best-effort, and deliberately not awaited into the response's success:
  // the removal is a fact once the row is written, and every client re-reads on
  // its own cadence. A host's removal must not fail because a notification
  // could not be published.
  const [room, guests] = await Promise.all([
    nudgeRoom(write as never, meeting.room_code),
    guestKeys.length > 0
      ? nudgeGuests(write as never, meeting.room_code, guestKeys)
      : Promise.resolve({ sent: 0, failed: 0 }),
  ]);
  if (room.failed > 0) console.warn("[removals] could not nudge the room");
  if (guests.failed > 0) console.warn("[removals] could not nudge", guests.failed, "of", guestKeys.length);

  return NextResponse.json({ ok: true, removed: 1 });
}

/**
 * Let somebody back in.
 *
 * A removal that could not be undone would be a new trap, and one this change
 * created: before it, "Remove" lasted until the person pressed reload, so a
 * misclick corrected itself. Now it is a fact, and a host who removes the wrong
 * tile — or the right one, and then changes their mind — needs a way back.
 *
 * Deleting the row rather than marking it: the question every reader asks is
 * "has this person been removed", and a tombstone that has to be filtered out
 * of that answer is one more place for the rule to be got wrong. The admission
 * row is left denied on purpose, so they knock again and the host decides at
 * the door, which is where they can see who it is.
 */
export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { signalId?: unknown };
  const signalId = typeof body.signalId === "string" ? body.signalId.trim() : "";
  if (!signalId) {
    return NextResponse.json({ error: "signalId required" }, { status: 400 });
  }

  const rls = await createServerClient();
  const { data } = await rls
    .from("live_meetings")
    .select("id, host_id, room_code")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  const meeting = data as { id: string; host_id: string | null; room_code: string } | null;
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the host can let someone back in" }, { status: 403 });
  }

  const write: SupabaseLike = hasSupabaseServiceEnv()
    ? (createServiceClient() as SupabaseLike)
    : (rls as SupabaseLike);

  // Resolved the same way the removal was written, from the row the knock
  // wrote — so undoing a removal cannot be aimed at somebody else either.
  const { subject } = await subjectOfTile(write, meeting.id, signalId);
  if (!subject) {
    return NextResponse.json({ error: "That participant cannot be identified" }, { status: 404 });
  }

  const match = subject.kind === "member" ? { user_id: subject.userId } : { guest_key: subject.guestKey };

  const { error } = await (write as any)
    .from("live_meeting_removals")
    .delete()
    .eq("meeting_id", meeting.id)
    .match(match);

  if (error) {
    console.error("[/api/meetings/[id]/removals] could not undo removal", error.message);
    return NextResponse.json({ error: "Could not let them back in" }, { status: 500 });
  }

  // And put the door back on its hinges.
  //
  // Lifting the bar is not enough on its own, and the first version of this
  // stopped there — which made "Allow back" do nothing at all. POST denies the
  // admission as well as recording the removal, and the knock is idempotent:
  // it returns an existing decision rather than reconsidering it. So a person
  // whose removal had been lifted knocked, was handed back the `denied` row,
  // and stayed out forever.
  //
  // Reset to `waiting` rather than `admitted`: this is the host lifting a ban,
  // not readmitting somebody to a meeting they may be nowhere near. They knock,
  // and the host decides at the door, where they can see who it is.
  const { error: admissionError } = await (write as any)
    .from("live_meeting_admissions")
    .update({ status: "waiting", decided_at: null, decided_by: null })
    .eq("meeting_id", meeting.id)
    .eq("status", "denied")
    .match(match);

  if (admissionError) {
    // The bar is lifted but the door is still shut, which reads to the host as
    // "Allow back did nothing". Reported, because the next press will fix it:
    // the removal row is already gone, so this runs again on its own.
    console.error("[/api/meetings/[id]/removals] removal lifted but admission still denied", admissionError.message);
    return NextResponse.json({ error: "Could not let them back in" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
