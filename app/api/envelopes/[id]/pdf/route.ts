import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { loadEnvelopePdf } from "@/lib/envelope-pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The unsigned document, for the owner's placement and countersign screens.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Row-level security limits this to the owner's organization.
  const { data } = await supabase.from("envelopes").select("pdf_storage_key").eq("id", id).maybeSingle();
  const key = (data as { pdf_storage_key: string | null } | null)?.pdf_storage_key;
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await loadEnvelopePdf(key);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
