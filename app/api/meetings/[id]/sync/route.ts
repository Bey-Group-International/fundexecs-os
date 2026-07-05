import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { syncMeetingExternal } from "@/lib/meetings/service";

export const dynamic = "force-dynamic";

// Manually (re-)run third-party calendar sync for a saved meeting. The native
// meeting is untouched on failure — it remains the source of truth.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();

  try {
    const result = await syncMeetingExternal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, id);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to sync meeting" }, { status: 500 });
  }
}
