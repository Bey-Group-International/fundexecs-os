import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { isExecutive } from "@/lib/intelligence";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { meetingIdForRoom } from "@/lib/meetings/prompt-meeting.server";

// Plan generation calls Claude; give it room beyond the default.
export const maxDuration = 60;

// POST /api/prompt — accept a user prompt; the Associate plans it into a
// multi-step workflow awaiting approval.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:prompt`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const { body, session_id, delegate, meeting_room } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return NextResponse.json({ error: "Missing 'body'" }, { status: 400 });
  }
  const sessionId = typeof session_id === "string" && session_id ? session_id : undefined;
  // Optional operator override: delegate this request to a specific desk.
  const desk = isExecutive(delegate) ? delegate : undefined;

  const supabase = await createServerClient();
  // Sent from a meeting page: the workflow is tied to that meeting, so a
  // follow-up pack waits for exactly it rather than for a title match.
  const meetingId = await meetingIdForRoom(supabase, auth.ctx.orgId, meeting_room);
  const result = await handlePrompt(
    { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId },
    body,
    sessionId,
    desk,
    { meetingId },
  );
  return NextResponse.json(result, { status: 201, headers: rateLimitHeaders(rateLimit, 30) });
}
