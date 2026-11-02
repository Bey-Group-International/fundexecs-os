import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { cleanBlocks } from "@/lib/envelope-fields";
import { documentPdf, TEMPLATE_PARTIES } from "@/lib/room-signing.server";
import type { Document } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The signature blocks the owner places on a data-room file, once, for every reader. The
// shapes match the envelope fields route so the same placement screen drives both.
async function load(roomId: string, documentId: string) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const supabase = await createServerClient();
  // Row-level security keeps this to the member's own organization.
  const { data: row } = await supabase
    .from("data_room_documents")
    .select("signature_blocks, require_signature")
    .eq("organization_id", ctx.orgId)
    .eq("room_id", roomId)
    .eq("document_id", documentId)
    .maybeSingle();
  if (!row) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  const { data: doc } = await supabase.from("documents").select("id, name, storage_key, content").eq("id", documentId).eq("organization_id", ctx.orgId).maybeSingle();
  if (!doc) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  return { ctx, supabase, row: row as { signature_blocks: unknown; require_signature: boolean }, doc: doc as Pick<Document, "id" | "name" | "storage_key" | "content"> } as const;
}

export async function GET(_req: Request, props: { params: Promise<{ roomId: string; documentId: string }> }) {
  const { roomId, documentId } = await props.params;
  if (!UUID.test(roomId) || !UUID.test(documentId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await load(roomId, documentId);
  if ("error" in r) return r.error;
  const blocks = Array.isArray(r.row.signature_blocks) ? (r.row.signature_blocks as Record<string, unknown>[]) : [];
  return NextResponse.json({
    envelope: { id: documentId, title: r.doc.name, status: "draft" },
    recipients: [
      { id: "signer", name: "The reader", email: "", role: "signer", routing_order: 1, status: "pending" },
      { id: "owner", name: "You", email: "", role: "owner", routing_order: 2, status: "pending" },
    ],
    fields: blocks.map((b, i) => ({ id: `t${i}`, ...b })),
  });
}

export async function PUT(req: Request, props: { params: Promise<{ roomId: string; documentId: string }> }) {
  const { roomId, documentId } = await props.params;
  if (!UUID.test(roomId) || !UUID.test(documentId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await load(roomId, documentId);
  if ("error" in r) return r.error;
  if (!canAdminOrg(r.ctx.role)) return NextResponse.json({ error: "Only an owner or admin can set up signing." }, { status: 403 });
  if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not available right now." }, { status: 503 });

  let body: { blocks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const bytes = await documentPdf(createServiceClient() as never, r.doc);
  if (!bytes) return NextResponse.json({ error: "Only a PDF or a written document can be signed." }, { status: 409 });
  const pageCount = (await PDFDocument.load(bytes)).getPageCount();

  const cleaned = cleanBlocks(body.blocks, [...TEMPLATE_PARTIES], pageCount);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  // Every reader and the countersigner each need somewhere to sign, or a document could be "signed" with no signature on it.
  const hasSig = (who: string) => cleaned.blocks.some((b) => b.recipient_id === who && b.field_type === "signature");
  if (cleaned.blocks.length && (!hasSig("signer") || !hasSig("owner"))) {
    return NextResponse.json({ error: "Add a signature block for the reader and one for yourself (you countersign)." }, { status: 400 });
  }

  const { error } = await r.supabase
    .from("data_room_documents")
    .update({ signature_blocks: cleaned.blocks.length ? cleaned.blocks : null })
    .eq("organization_id", r.ctx.orgId!)
    .eq("room_id", roomId)
    .eq("document_id", documentId);
  if (error) return NextResponse.json({ error: "Could not save the blocks." }, { status: 500 });
  return NextResponse.json({ ok: true, count: cleaned.blocks.length, pageCount });
}
