import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { handlePrompt } from "@/lib/engine";

// POST /api/prompt — accept a user prompt, route it to a hub + agent, and
// create the resulting task (which kicks off mock execution).
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { body } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return NextResponse.json({ error: "Missing 'body'" }, { status: 400 });
  }

  const supabase = createServerClient();
  const result = await handlePrompt(
    { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId },
    body,
  );
  return NextResponse.json(result, { status: 201 });
}
