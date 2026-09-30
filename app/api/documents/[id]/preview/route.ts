import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { getDocumentText } from "@/lib/document-text.server";
import type { Document } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GP-side structured preview for an uploaded file. The RLS-scoped read proves
// the caller's org holds the document before the text layer is read.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("id, storage_key")
    .eq("id", params.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Pick<Document, "id" | "storage_key"> | null;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = await getDocumentText({ orgId: ctx.orgId, documentId: doc.id, storageKey: doc.storage_key });
  return NextResponse.json(
    { status: result?.status ?? "unsupported", preview: result?.preview ?? null, text: result?.preview ? null : (result?.text ?? "").slice(0, 200_000) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
