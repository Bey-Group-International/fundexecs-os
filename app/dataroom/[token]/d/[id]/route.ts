import { NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { gateSatisfied, readGatePass } from "@/lib/data-room-gate";
import type { DataRoomShare, Document } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* not absolute */
  }
  return null;
}

// Token-gated open-and-track: validates the share, checks the same
// server-verified gate the room page enforces (previously this route only
// checked token validity/expiry — any document id that appeared in the page's
// props could be opened directly, bypassing password/NDA/email entirely) and
// the share's allowed_sections whitelist, logs a 'document' view, then
// redirects to the document's external link. Invalid or ungated requests
// bounce to the room.
export async function GET(req: Request, { params }: { params: { token: string; id: string } }) {
  const roomUrl = new URL(`/dataroom/${params.token}`, req.url);
  if (!hasSupabaseServiceEnv()) return NextResponse.redirect(roomUrl);

  const supabase = createServiceClient();
  const { data: shareRow } = await supabase
    .from("data_room_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();
  const share = shareRow as DataRoomShare | null;
  if (!share || share.revoked_at) return NextResponse.redirect(roomUrl);
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return NextResponse.redirect(roomUrl);

  const pass = await readGatePass(share.id);
  const passed = gateSatisfied(
    { require_email: share.require_email ?? false, require_nda: share.require_nda ?? false, password_hash: share.password_hash },
    pass,
  );
  if (!passed) return NextResponse.redirect(roomUrl);

  const { data: docRow } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", share.organization_id)
    .maybeSingle();
  const doc = docRow as Document | null;
  const href = safeHref(doc?.storage_key ?? null);
  if (!doc || !href) return NextResponse.redirect(roomUrl);

  const allowedSections = (share as { allowed_sections?: string[] | null }).allowed_sections ?? null;
  if (allowedSections && (!doc.doc_type || !allowedSections.includes(doc.doc_type))) {
    return NextResponse.redirect(roomUrl);
  }

  await supabase
    .from("data_room_views")
    .insert({ organization_id: share.organization_id, share_id: share.id, document_id: doc.id, kind: "document" })
    .then(() => undefined, () => undefined);

  return NextResponse.redirect(href);
}
