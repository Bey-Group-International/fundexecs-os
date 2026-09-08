import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { nudgeGuests } from "@/lib/meetings/admission-broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

// Host admit/deny for the waiting room. The host reads the pending knocks over
// Realtime (org-read RLS), but the DECISION is written here through the service
// role after verifying the caller actually hosts this meeting in their org —
// there is no client-writable policy on live_meeting_admissions.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { decision?: string; admissionId?: string; all?: boolean };
  const decision = body.decision === "deny" ? "denied" : body.decision === "admit" ? "admitted" : null;
  if (!decision) return NextResponse.json({ error: "decision must be 'admit' or 'deny'" }, { status: 400 });

  // Verify the caller hosts this meeting in their active org.
  const rls = await createServerClient();
  const { data: meeting } = await rls
    .from("live_meetings")
    .select("id, host_id, room_code")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  const mt = meeting as { id: string; host_id: string | null; room_code: string } | null;
  if (!mt) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (mt.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the host can admit or deny" }, { status: 403 });
  }

  const write = hasSupabaseServiceEnv() ? createServiceClient() : rls;
  const patch = { status: decision, decided_at: new Date().toISOString(), decided_by: auth.ctx.userId };

  let query = (write as any).from("live_meeting_admissions").update(patch).eq("meeting_id", id);
  if (body.all === true && decision === "admitted") {
    // Admit everyone currently waiting.
    query = query.eq("status", "waiting");
  } else if (typeof body.admissionId === "string" && body.admissionId) {
    query = query.eq("id", body.admissionId);
  } else {
    return NextResponse.json({ error: "admissionId or all required" }, { status: 400 });
  }

  // The updated rows come back so the guests they belong to can be told. Without
  // this the decision would sit in the database until each guest's next poll
  // happened to ask for it.
  const { data: decided, error } = await (query as any).select("guest_key");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const guestKeys = ((decided ?? []) as Array<{ guest_key: string }>).map((r) => r.guest_key);
  // Best-effort, and deliberately not awaited into the response's success: the
  // decision is made and stored either way, and every guest polls as a safety
  // net. A host's admit must not fail because a notification could not be sent.
  if (guestKeys.length > 0) {
    const { failed } = await nudgeGuests(write as never, mt.room_code, guestKeys);
    if (failed > 0) console.warn("[admissions] could not nudge", failed, "of", guestKeys.length);
  }

  return NextResponse.json({ ok: true, decided: guestKeys.length });
}
