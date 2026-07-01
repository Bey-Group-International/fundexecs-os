import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { AlertEvent } from "@/lib/alert-rules";

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

  const { data, error } = await supabase
    .from("alert_events")
    .select("*")
    .eq("org_id", orgId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/alerts error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as AlertEvent[]);
}
