import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { MAX_BATCH, type TranscriptRow } from "@/lib/meetings/transcript-buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save transcript lines for a live meeting.
 *
 * This exists because the client could not do it. `live_meeting_transcripts`
 * is behind an RLS policy keyed on `auth.uid()` — host or participant row — and
 * an invite-link GUEST has no session at all. Their every insert was rejected,
 * silently, by a policy that cannot fail loudly. Nothing noticed, because every
 * participant was also saving every OTHER participant's lines: the host's copy
 * of a guest's words covered for the guest's own write never landing. Fixing
 * the duplication without fixing this would have deleted guests from the record
 * entirely — the transcript would have got cleaner and emptier at once.
 *
 * So the same two doors as the ICE endpoint: a signed-in member of the meeting,
 * or a guest the host has already admitted. The write itself goes through the
 * service role, after the route has decided who is asking.
 *
 * Idempotent. Rows carry the client's own line ids as primary keys, so a flush
 * that timed out and is being retried conflicts and stores nothing new — which
 * is what lets the client retry at all. Before this, a failed write was a
 * choice between losing the line and duplicating it, and the code quietly chose
 * to lose it.
 */

/** Generous for a call flushing every fifteen seconds, tight enough not to be a write hose. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

/** One utterance. Speech recognition does not produce sentences longer than this. */
const MAX_TEXT = 4_000;

type Params = Promise<{ id: string }>;
type SupabaseLike = { from: (table: string) => any };

/**
 * Accept only what this caller could honestly have said.
 *
 * `speaker_user_id` is the one field with real authority — the log and the
 * institutional record use it to tell two people with the same display name
 * apart — so it is taken from the session rather than from the body. A guest
 * gets null, always. Without this, anyone the host admitted could post lines
 * stamped with the host's own account id.
 *
 * A display name is not protected and cannot be: a guest chooses their own at
 * the door, and someone willing to impersonate a colleague in the transcript
 * could just as easily say the words out loud.
 */
function sanitize(rows: unknown, meetingId: string, userId: string | null): TranscriptRow[] {
  if (!Array.isArray(rows)) return [];
  const out: TranscriptRow[] = [];
  for (const raw of rows.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const text = typeof r.text === "string" ? r.text.slice(0, MAX_TEXT) : "";
    const ts = typeof r.ts === "string" ? r.ts : "";
    if (!id || !text.trim() || !ts || Number.isNaN(Date.parse(ts))) continue;
    const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.min(1, Math.max(0, r.confidence))
      : 1;
    out.push({
      id,
      meeting_id: meetingId,
      speaker: typeof r.speaker === "string" ? r.speaker.slice(0, 120) : "",
      speaker_id: typeof r.speaker_id === "string" ? r.speaker_id.slice(0, 120) : "",
      speaker_user_id: userId,
      confidence,
      text,
      ts,
      overlapped: r.overlapped === true,
    });
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const limit = checkRateLimit({
    key: `meeting-transcript:${clientIp(req)}`,
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

  const body = (await req.json().catch(() => ({}))) as { lines?: unknown };
  const rows = sanitize(body.lines, id, caller.userId);
  if (!rows.length) return NextResponse.json({ saved: 0 });

  const write: SupabaseLike = hasSupabaseServiceEnv()
    ? createServiceClient()
    : ((await createServerClient()) as SupabaseLike);

  const { error } = await write
    .from("live_meeting_transcripts")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    // Answered as a failure on purpose. The client keeps unconfirmed lines in
    // its pending set and retries them, so a 500 here costs a retry; a 200
    // would cost the words.
    console.error("[/api/meetings/[id]/transcript]", error);
    return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
  }

  // The ids that are now safe to forget.
  return NextResponse.json({ saved: rows.length, ids: rows.map((r) => r.id) });
}
