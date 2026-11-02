import { NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { loadEnvelopePdf } from "@/lib/envelope-pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The document a recipient was asked to sign, reached by their own signing token. Only
// while the envelope is out for signature: a draft, a voided or a declined one serves nothing.
export async function GET(_req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!UUID.test(token) || !hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = createServiceClient();
  const { data: rec } = await supabase
    .from("envelope_recipients")
    .select("status, envelopes (status, pdf_storage_key)")
    .eq("signing_token", token)
    .maybeSingle();
  const row = rec as unknown as { status: string; envelopes: { status: string; pdf_storage_key: string | null } | null } | null;
  const env = row?.envelopes;
  if (!row || !env?.pdf_storage_key || row.status === "declined") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["sent", "partially_signed", "completed"].includes(env.status)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await loadEnvelopePdf(env.pdf_storage_key);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
