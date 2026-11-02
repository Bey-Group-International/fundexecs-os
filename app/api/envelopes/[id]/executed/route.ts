import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { buildSignedPdf } from "@/lib/signing/executed-pdf.server";
import { sealPdf } from "@/lib/signing/seal.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An envelope's document as a PDF with each signer's drawn signature stamped on
// the signature page. Members of the owning org only (row-level security). The
// seal is applied only once every recipient has signed, so a sealed file always
// means a fully executed document.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: env } = await supabase
    .from("envelopes")
    .select("id, title, document_content, status")
    .eq("id", id)
    .maybeSingle();
  const envelope = env as { id: string; title: string; document_content: string | null; status: string } | null;
  if (!envelope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recs } = await supabase
    .from("envelope_recipients")
    .select("name, email, status, signed_at, signature_data, ip_address, routing_order")
    .eq("envelope_id", id)
    .order("routing_order", { ascending: true });
  const recipients = (recs ?? []) as {
    name: string; email: string; status: string; signed_at: string | null;
    signature_data: string | null; ip_address: string | null;
  }[];
  const signed = recipients.filter((r) => r.status === "signed" && r.signed_at);
  if (signed.length === 0) return NextResponse.json({ error: "Nothing has been signed yet" }, { status: 404 });

  const text = envelope.document_content ?? envelope.title;
  const built = await buildSignedPdf({
    title: envelope.title || "Signed document",
    text,
    stamps: signed.map((r) => ({
      label: "Signer",
      name: r.name,
      email: r.email,
      signedAt: r.signed_at!,
      // Partial address only, as everywhere else we show one.
      ipHint: r.ip_address ? r.ip_address.split(".").slice(0, 3).join(".") : null,
      signaturePng: r.signature_data,
    })),
    awaiting: recipients.filter((r) => r.status !== "signed").map((r) => `${r.name} (${r.email})`),
    fingerprint: createHash("sha256").update(text, "utf8").digest("hex"),
    recordId: envelope.id,
  });
  const executed = envelope.status === "completed";
  const out = executed ? await sealPdf(built, { reason: `Executed ${envelope.title}`, name: "FundExecs OS" }) : { pdf: built, sealed: false };

  const name = (envelope.title || "document").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "document";
  return new NextResponse(Buffer.from(out.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}${executed ? "-executed" : "-signed-so-far"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
