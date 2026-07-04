import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { discardSynthesis } from "@/lib/brains/synthesis";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, props: RouteContext): Promise<NextResponse> {
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

  try {
    await discardSynthesis(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/brains/synthesis/${id}/discard error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
