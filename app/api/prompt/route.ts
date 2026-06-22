import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";
import { isExecutive } from "@/lib/intelligence";

// Plan generation calls Claude; give it room beyond the default.
export const maxDuration = 60;

// POST /api/prompt — accept a user prompt; the Associate plans it into a
// multi-step workflow awaiting approval.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { body, session_id, delegate } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return NextResponse.json({ error: "Missing 'body'" }, { status: 400 });
  }
  const sessionId = typeof session_id === "string" && session_id ? session_id : undefined;
  // Optional operator override: delegate this request to a specific desk.
  const desk = isExecutive(delegate) ? delegate : undefined;

  const supabase = createServerClient();
  const result = await handlePrompt(
    { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId },
    body,
    sessionId,
    desk,
  );
  return NextResponse.json(result, { status: 201 });
}
