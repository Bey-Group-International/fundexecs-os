import { NextResponse } from "next/server";
import { resolveSharedDocument } from "@/lib/data-room-access.server";
import { getDocumentText } from "@/lib/document-text.server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The structured preview (Word paragraphs, Excel sheets, PowerPoint slides) the
// public viewer renders for Office files. Same access check as opening the file.
// Only the preview is returned, never the raw text layer.
export async function GET(req: Request, props: { params: Promise<{ token: string; id: string }> }) {
  const params = await props.params;
  const rateLimit = checkRateLimit({
    key: `ip:${clientIp(req)}:dataroom-preview:${params.token}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimitHeaders(rateLimit, 60) });
  }
  const access = await resolveSharedDocument(params.token, params.id);
  if (!access.ok) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const result = await getDocumentText({
    orgId: access.share.organization_id,
    documentId: access.doc.id,
    storageKey: access.doc.storage_key,
  });
  return NextResponse.json(
    { status: result?.status ?? "unsupported", preview: result?.preview ?? null, text: result?.preview ? null : (result?.text ?? "").slice(0, 200_000) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
