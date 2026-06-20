import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
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

// Token-gated open-and-track: validates the share, logs a 'document' view, then
// redirects to the document's external link. Invalid requests bounce to the room.
export async function GET(req: Request, { params }: { params: { token: string; id: string } }) {
  const roomUrl = new URL(`/dataroom/${params.token}`, req.url);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.redirect(roomUrl);

  const supabase = createServiceClient();
  const { data: shareRow } = await supabase
    .from("data_room_shares")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();
  const share = shareRow as DataRoomShare | null;
  if (!share || share.revoked_at) return NextResponse.redirect(roomUrl);
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return NextResponse.redirect(roomUrl);

  const { data: docRow } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", share.organization_id)
    .maybeSingle();
  const doc = docRow as Document | null;
  const href = safeHref(doc?.storage_key ?? null);
  if (!doc || !href) return NextResponse.redirect(roomUrl);

  await supabase
    .from("data_room_views")
    .insert({ organization_id: share.organization_id, share_id: share.id, document_id: doc.id, kind: "document" })
    .then(() => undefined, () => undefined);

  return NextResponse.redirect(href);
}
