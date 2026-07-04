import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { approveSynthesis } from "@/lib/brains/synthesis";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, props: RouteContext): Promise<NextResponse> {
  const params = await props.params;
  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;

  if (!id) {
    return NextResponse.json(
      { error: "Synthesis id is required" },
      { status: 400 },
    );
  }

  // Optional: persist an edited draft before approving
  try {
    const body = await req.json().catch(() => ({}));
    if (body.draft_content !== undefined) {
      const { error: updateError } = await supabase
        .from("synthesis_queue")
        .update({ draft_content: body.draft_content })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/brains/synthesis/${id}/approve patch error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    await approveSynthesis(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/brains/synthesis/${id}/approve error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
