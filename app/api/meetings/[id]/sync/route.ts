import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { markMeetingPendingSync } from "@/lib/meetings/service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();

  try {
    return NextResponse.json(await markMeetingPendingSync(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to request sync" }, { status: 500 });
  }
}
