import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { clearUpcomingMeetingsLocal } from "@/lib/meetings/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const supabase = await createServerClient();

  try {
    return NextResponse.json(await clearUpcomingMeetingsLocal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to clear meetings" }, { status: 500 });
  }
}
