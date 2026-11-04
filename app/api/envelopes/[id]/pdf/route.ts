import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { loadEnvelopePdf } from "@/lib/envelope-pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The unsigned document, for the owner's placement and countersign screens. It does not change
// once sent, and the screens of one envelope all load it, so the browser keeps it and asks only
// whether it is still the same file (by its SHA-256); an unchanged file is not read from storage
// or sent again.
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Row-level security limits this to the owner's organization.
  const { data } = await supabase.from("envelopes").select("pdf_storage_key, document_sha256").eq("id", id).maybeSingle();
  const row = data as { pdf_storage_key: string | null; document_sha256: string | null } | null;
  const key = row?.pdf_storage_key;
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only a file with a known fingerprint can be cached; without one, nothing is kept.
  const etag = row?.document_sha256 ? `"${row.document_sha256}"` : null;
  if (etag && req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }
  const bytes = await loadEnvelopePdf(key);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": etag ? "private, no-cache" : "private, no-store",
      ...(etag ? { ETag: etag } : {}),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
