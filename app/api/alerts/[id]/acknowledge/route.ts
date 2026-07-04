import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(_req: NextRequest, props: RouteContext): Promise<NextResponse> {
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
      { error: "Alert event id is required" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("alert_events")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: user.id,
    })
    .eq("id", id);

  if (error) {
    console.error(`PATCH /api/alerts/${id}/acknowledge error:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
