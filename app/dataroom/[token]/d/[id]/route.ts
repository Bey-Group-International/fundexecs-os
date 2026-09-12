import { NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { gateSatisfied, readGatePass } from "@/lib/data-room-gate";
import { isRoomOpen } from "@/lib/data-room-viewer.server";
import { isExternalLink, isUploadedFile } from "@/lib/document-files";
import { signDocumentUrl } from "@/lib/document-storage.server";
import type { DataRoomShare, Document } from "@/lib/supabase/database.types";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function safeHref(url: string | null): string | null {
  if (!isExternalLink(url)) return null;
  return new URL(url as string).href;
}

// Token-gated open-and-track: validates the share, checks the same
// server-verified gate the room page enforces (previously this route only
// checked token validity/expiry — any document id that appeared in the page's
// props could be opened directly, bypassing password/NDA/email entirely), then
// checks the room's publish manifest and the share's allowed_sections
// whitelist, logs a 'document' view, and redirects to the file — an external
// link as-is, or a freshly signed URL for a file uploaded into our private
// bucket. Invalid or ungated requests bounce to the room.
export async function GET(req: Request, props: { params: Promise<{ token: string; id: string }> }) {
  const params = await props.params;
  const roomUrl = new URL(`/dataroom/${params.token}`, req.url);
  const rateLimit = checkRateLimit({
    key: `ip:${clientIp(req)}:dataroom-doc:${params.token}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 60) },
    );
  }
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

  // Membership is checked against the room's publish manifest first. Being in
  // the org's library is not enough — an unpublished draft must stay
  // unreachable even to someone holding a valid token and the document's id.
  const roomId = share.room_id;
  if (!roomId) return NextResponse.redirect(roomUrl);
  // An archived room serves nothing, whatever its links still say.
  if (!(await isRoomOpen(supabase, share.organization_id, roomId))) {
    return NextResponse.redirect(roomUrl);
  }
  const { data: manifestRow } = await supabase
    .from("data_room_documents")
    .select("id")
    .eq("organization_id", share.organization_id)
    .eq("room_id", roomId)
    .eq("document_id", params.id)
    .maybeSingle();
  if (!manifestRow) return NextResponse.redirect(roomUrl);

  const { data: docRow } = await supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", share.organization_id)
    .maybeSingle();
  const doc = docRow as Document | null;
  if (!doc || !doc.storage_key) return NextResponse.redirect(roomUrl);

  const allowedSections = (share as { allowed_sections?: string[] | null }).allowed_sections ?? null;
  if (allowedSections && (!doc.doc_type || !allowedSections.includes(doc.doc_type))) {
    return NextResponse.redirect(roomUrl);
  }

  // A document is either a link to a file living elsewhere or a file uploaded
  // into our private bucket. The bucket has no public URL by design, so an
  // uploaded file is served by minting a signed URL here — after every check
  // above has passed, and never before.
  let destination: string | null = safeHref(doc.storage_key);
  if (!destination && isUploadedFile(doc.storage_key)) {
    // Served inline, not as an attachment: a reader opening the LPA from a
    // data room expects it to render, the way a linked file does.
    destination = await signDocumentUrl(doc.storage_key, { client: supabase });
  }
  if (!destination) return NextResponse.redirect(roomUrl);

  await supabase
    .from("data_room_views")
    .insert({
      organization_id: share.organization_id,
      share_id: share.id,
      room_id: roomId,
      document_id: doc.id,
      kind: "document",
    })
    .then(() => undefined, () => undefined);

  return NextResponse.redirect(destination);
}
