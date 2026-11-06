// Changing a shared clip: revoke it, switch saving a copy on or off, or try
// cutting it again after a failure. Only its creator can; the update policy
// and the column grants enforce that, and limit a creator to those columns.
import { NextRequest, NextResponse, after } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { SHARE_COLUMNS, serializeShare, type ShareRow } from "@/lib/meetings/recording-share.server";
import { buildClip, purgeClip } from "@/lib/meetings/recording-clip.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { shareId } = await params;
  const body = (await req.json().catch(() => ({}))) as { revoke?: unknown; allowDownload?: unknown; retry?: unknown };
  const supabase = await createServerClient();

  if (body.revoke === true) {
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
    // The clip's media goes now, not at the next sweep.
    if (hasSupabaseServiceEnv()) {
      after(async () => {
        await purgeClip(createServiceClient(), row.id);
      });
    }
    return NextResponse.json({ share: serializeShare(row) });
  }

  if (typeof body.allowDownload === "boolean") {
    const { data, error } = await supabase
      .from("recording_shares")
      .update({ allow_download: body.allowDownload } as never)
      .eq("id", shareId)
      .eq("created_by", auth.ctx.userId)
      .select(SHARE_COLUMNS);
    if (error) return NextResponse.json({ error: "Could not change the link." }, { status: 500 });
    const row = ((data ?? []) as ShareRow[])[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ share: serializeShare(row) });
  }

  if (body.retry === true) {
    // Ownership through the caller's own client; the reset through the
    // server's, because the trimming state is not the creator's to write.
    const { data } = await supabase
      .from("recording_shares")
      .select(SHARE_COLUMNS)
      .eq("id", shareId)
      .eq("created_by", auth.ctx.userId)
      .maybeSingle();
    const row = data as ShareRow | null;
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.clip_status !== "failed") return NextResponse.json({ error: "This clip isn't waiting on a retry." }, { status: 409 });
    if (row.revoked_at || Date.parse(row.expires_at) <= Date.now()) {
      return NextResponse.json({ error: "This link is no longer active." }, { status: 410 });
    }
    if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not available" }, { status: 503 });
    const service = createServiceClient();
    await service
      .from("recording_shares")
      .update({ clip_status: "pending", clip_error: null, clip_attempts: 0, clip_started_at: null } as never)
      .eq("id", shareId);
    after(async () => {
      await buildClip(createServiceClient(), shareId);
    });
    return NextResponse.json({ share: serializeShare({ ...row, clip_status: "pending", clip_error: null }) });
  }

  return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
}
