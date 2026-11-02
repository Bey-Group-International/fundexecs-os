import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { documentPdf } from "@/lib/room-signing.server";
import type { Document } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A published file as the PDF the owner places signature blocks on (members of the owning org).
export async function GET(_req: Request, props: { params: Promise<{ roomId: string; documentId: string }> }) {
  const { roomId, documentId } = await props.params;
  if (!UUID.test(roomId) || !UUID.test(documentId) || !hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createServerClient();
  const { data: row } = await supabase.from("data_room_documents").select("id").eq("organization_id", ctx.orgId).eq("room_id", roomId).eq("document_id", documentId).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: doc } = await supabase.from("documents").select("name, storage_key, content").eq("id", documentId).eq("organization_id", ctx.orgId).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await documentPdf(createServiceClient() as never, doc as Pick<Document, "storage_key" | "content" | "name">);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
