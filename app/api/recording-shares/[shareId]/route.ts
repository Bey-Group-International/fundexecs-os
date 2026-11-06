// Revoking a shared clip. Only its creator can, which the update policy
// enforces; a revoked link answers "no longer available" at once.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { SHARE_COLUMNS, serializeShare, type ShareRow } from "@/lib/meetings/recording-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { shareId } = await params;
  const body = (await req.json().catch(() => ({}))) as { revoke?: unknown };
  if (body.revoke !== true) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("recording_shares")
    .update({ revoked_at: new Date().toISOString() } as never)
    .eq("id", shareId)
    .eq("created_by", auth.ctx.userId)
    .is("revoked_at", null)
    .select(SHARE_COLUMNS);
  if (error) return NextResponse.json({ error: "Could not revoke the link." }, { status: 500 });
  const row = ((data ?? []) as ShareRow[])[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ share: serializeShare(row) });
}
