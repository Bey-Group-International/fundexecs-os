// A shared clip's access log, for the person who made the link: each opening
// and download, when, and on what kind of device. Read through the caller's
// own client, so the policy shows a creator their own links' logs and nobody
// anyone else's.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { viewSummary } from "@/lib/meetings/recording-share";
import { serializeView } from "@/lib/meetings/recording-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { shareId } = await params;
  const supabase = await createServerClient();
  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from("recording_share_views")
    .select("kind, viewer, device, created_at")
    .eq("share_id", shareId)
    .order("created_at", { ascending: false })
    .limit(200);
  // Before the log exists, or for a link that is not theirs: an empty log.
  if (error) return NextResponse.json({ views: [], summary: viewSummary([]) });
  const views = ((data ?? []) as Array<{ kind: string; viewer: string; device: string | null; created_at: string }>).map(serializeView);
  return NextResponse.json({ views, summary: viewSummary(views) });
}
