import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { listPendingSyntheses } from "@/lib/brains/synthesis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId");

  if (!orgId) {
    return NextResponse.json(
      { error: "orgId query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const items = await listPendingSyntheses(orgId);
    return NextResponse.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("GET /api/brains/synthesis error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
