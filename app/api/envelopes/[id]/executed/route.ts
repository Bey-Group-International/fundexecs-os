import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { buildSignedPdf } from "@/lib/signing/executed-pdf.server";
import { stampBlocks, type StampField } from "@/lib/signing/stamp.server";
import { sealPdf } from "@/lib/signing/seal.server";
import { loadEnvelopePdf } from "@/lib/envelope-pdf.server";
import { envelopeCopyTokenValid } from "@/lib/envelope-notify.server";
import { formatBlockDateTime } from "@/lib/signing/blocks";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function build(db: SupabaseClient, id: string) {
  const { data: env } = await db.from("envelopes").select("id, title, document_content, status, pdf_storage_key, document_sha256").eq("id", id).maybeSingle();
  const envelope = env as { id: string; title: string; document_content: string | null; status: string; pdf_storage_key: string | null; document_sha256: string | null } | null;
  if (!envelope) return null;
  const [{ data: recs }, { data: flds }] = await Promise.all([
    db.from("envelope_recipients").select("id, name, email, role, status, signed_at, signature_data, ip_address, routing_order").eq("envelope_id", id).order("routing_order", { ascending: true }),
    db.from("envelope_fields").select("recipient_id, field_type, page, x_pct, y_pct, width_pct, height_pct, response").eq("envelope_id", id),
  ]);
  const recipients = (recs ?? []) as { id: string; name: string; email: string; role: string; status: string; signed_at: string | null; signature_data: string | null; ip_address: string | null }[];
  const signed = recipients.filter((r) => r.status === "signed" && r.signed_at);
  if (signed.length === 0) return null;

  const stamps = signed.map((r) => ({
    label: r.role === "owner" ? "Countersigned by" : "Signer",
    name: r.name,
    email: r.email,
    signedAt: r.signed_at!,
    ipHint: r.ip_address ? r.ip_address.split(".").slice(0, 3).join(".") : null,
    signaturePng: r.signature_data,
  }));
  const awaiting = recipients.filter((r) => r.status !== "signed").map((r) => `${r.name} (${r.email})`);
  const text = envelope.document_content ?? envelope.title;
  const fingerprint = envelope.document_sha256 ?? createHash("sha256").update(text, "utf8").digest("hex");

  let built: Uint8Array;
  const original = envelope.pdf_storage_key ? await loadEnvelopePdf(envelope.pdf_storage_key) : null;
  if (original) {
    // Each signer's answers and signature go onto the page where the owner placed the block.
    const byId = new Map(recipients.map((r) => [r.id, r]));
    const fields: StampField[] = ((flds ?? []) as { recipient_id: string; field_type: string; page: number; x_pct: number; y_pct: number; width_pct: number; height_pct: number; response: string | null }[])
      .filter((f) => byId.get(f.recipient_id)?.status === "signed")
      .map((f) => ({
        page: f.page,
        xPct: f.x_pct,
        yPct: f.y_pct,
        widthPct: f.width_pct,
        heightPct: f.height_pct,
        type: f.field_type,
        value: f.field_type === "datetime" && f.response ? formatBlockDateTime(f.response) : f.response,
        signaturePng: f.field_type === "signature" || f.field_type === "initials" ? byId.get(f.recipient_id)?.signature_data : null,
      }));
    const stamped = await stampBlocks(original, fields);
    built = await buildSignedPdf({ title: envelope.title, basePdf: stamped, stamps, awaiting, fingerprint, recordId: envelope.id });
  } else {
    built = await buildSignedPdf({ title: envelope.title, text, stamps, awaiting, fingerprint, recordId: envelope.id });
  }
  const executed = envelope.status === "completed";
  const out = executed ? await sealPdf(built, { reason: `Executed ${envelope.title}`, name: "FundExecs OS" }) : { pdf: built, sealed: false };
  return { pdf: out.pdf, title: envelope.title, executed };
}

// The document with every signer's blocks and signature on it. Two ways in: a member of
// the owning organization, or anyone holding the HMAC link emailed once it is fully signed.
// The seal goes on only when every party has signed, so a sealed file means fully executed.
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("t");

  let built = null;
  if (token) {
    if (!envelopeCopyTokenValid(id, token) || !hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    built = await build(createServiceClient() as unknown as SupabaseClient, id);
  } else {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The member's own client: row-level security limits this to their organization.
    built = await build(supabase as unknown as SupabaseClient, id);
  }
  if (!built) return NextResponse.json({ error: "Nothing has been signed yet" }, { status: 404 });

  const name = (built.title || "document").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "document";
  return new NextResponse(Buffer.from(built.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}${built.executed ? "-executed" : "-signed-so-far"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
