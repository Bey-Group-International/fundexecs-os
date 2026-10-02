import { NextResponse } from "next/server";
import { resolveSharedDocument, watermarkLabel } from "@/lib/data-room-access.server";
import {
  DOCUMENT_BUCKET,
  downloadFileName,
  fileExtension,
  isExternalLink,
  isUploadedFile,
} from "@/lib/document-files";
import { signDocumentUrl } from "@/lib/document-storage.server";
import { MAX_WATERMARK_BYTES, watermarkPdf } from "@/lib/pdf-watermark.server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// Watermarking reads and rewrites the whole PDF in this function.
export const maxDuration = 60;

function safeHref(url: string | null): string | null {
  if (!isExternalLink(url)) return null;
  return new URL(url as string).href;
}

function refuse(message: string, status: number): Response {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Token-gated open, embed, and download for one document.
//
// Access is decided by `resolveSharedDocument` (live link, server-verified gate,
// open room, publish manifest or single-document scope, section allowlist).
// What is served then depends on the link's view controls:
//
//   ?download=1  — save the file under its document name. Refused outright when
//                  the link is view-only.
//   ?embed=1     — the bytes the in-app viewer renders. Always allowed once
//                  access passes; this is how a view-only link is read at all.
//   (neither)    — open in a new tab. On a view-only link this goes back to the
//                  viewer instead of handing out the raw file.
//
// A watermarked link never hands out a signed Storage URL for a PDF: the bytes
// are stamped here and streamed, so there is no unmarked copy to intercept.
export async function GET(req: Request, props: { params: Promise<{ token: string; id: string }> }) {
  const params = await props.params;
  const url = new URL(req.url);
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

  const access = await resolveSharedDocument(params.token, params.id);
  if (!access.ok) return NextResponse.redirect(roomUrl);
  const { supabase, share, doc, roomId, viewerEmail } = access;
  if (!doc.storage_key) return NextResponse.redirect(roomUrl);

  const wantsDownload = url.searchParams.get("download") === "1";
  const embed = url.searchParams.get("embed") === "1";
  const allowDownload = share.allow_download ?? true;

  if (wantsDownload && !allowDownload) {
    return refuse("Downloads are turned off for this link. You can read the document in the data room.", 403);
  }
  if (!embed && !wantsDownload && !allowDownload && isUploadedFile(doc.storage_key)) {
    // View-only: reading happens inside the viewer, not in a bare browser tab.
    return NextResponse.redirect(new URL(`/dataroom/${params.token}?doc=${doc.id}`, req.url));
  }

  // Log opens and downloads, not the viewer's embed fetches — those follow a
  // room visit that is already recorded, and would double-count every read.
  if (!embed) {
    await supabase
      .from("data_room_views")
      .insert({
        organization_id: share.organization_id,
        share_id: share.id,
        room_id: roomId,
        document_id: doc.id,
        kind: "document",
        action: wantsDownload ? "download" : "open",
        viewer_email: viewerEmail,
      } as never)
      .then(() => undefined, () => undefined);
  }

  const external = safeHref(doc.storage_key);
  if (external) return NextResponse.redirect(external);
  if (!isUploadedFile(doc.storage_key)) return NextResponse.redirect(roomUrl);

  const fileName = downloadFileName(doc.name, doc.storage_key);

  if ((share.watermark ?? false) && fileExtension(doc.storage_key) === ".pdf") {
    const { data: blob, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(doc.storage_key);
    if (error || !blob) return refuse("This document is temporarily unavailable.", 503);
    if (blob.size > MAX_WATERMARK_BYTES) {
      // Fail closed: a watermarked link never falls back to an unmarked copy.
      return refuse("This document is too large to watermark. Ask the sender for a copy.", 413);
    }
    try {
      const stamped = await watermarkPdf(
        new Uint8Array(await blob.arrayBuffer()),
        watermarkLabel(share, viewerEmail),
      );
      const disposition = wantsDownload ? "attachment" : "inline";
      return new NextResponse(Buffer.from(stamped), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return refuse("This document could not be prepared for viewing. Ask the sender for a copy.", 422);
    }
  }

  // Everything else: a short-lived signed URL, minted after every check above.
  // Downloads carry the document's name instead of the uuid it is stored under.
  const destination = await signDocumentUrl(doc.storage_key, {
    client: supabase,
    ...(wantsDownload ? { download: fileName } : {}),
  });
  if (!destination) return NextResponse.redirect(roomUrl);
  return NextResponse.redirect(destination);
}
