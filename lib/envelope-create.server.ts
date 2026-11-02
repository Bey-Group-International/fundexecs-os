// lib/envelope-create.server.ts
//
// Creating an envelope: the record, its recipients, the account owner as the last
// signer, and the document as a PDF with its fingerprint. Shared by the "new
// envelope" screen and by anything that prepares a document for someone (an LP's
// subscription agreement). Runs on the creator's own client, so row-level security
// decides what they may create.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDocumentPdf, type SignaturePageSpec } from "@/lib/signing/executed-pdf.server";
import { isPdfBytes, storeEnvelopePdf } from "@/lib/envelope-pdf.server";

export interface NewEnvelope {
  orgId: string;
  creator: { id: string; email: string | null; name: string | null };
  title: string;
  message?: string | null;
  /** The text kept with the envelope, and turned into the PDF when none is given. */
  documentContent: string;
  pdfBytes?: Uint8Array;
  /** Guidance lines appended to a generated PDF, so there is somewhere to click. */
  signaturePage?: SignaturePageSpec;
  recipients: { name: string; email: string; routingOrder?: number }[];
  lpSessionId?: string | null;
}

export type CreatedEnvelope =
  | { ok: true; envelopeId: string; recipients: { id: string; name: string; email: string; routing_order: number; signing_token: string }[] }
  | { ok: false; status: number; error: string };

export async function createEnvelope(supabase: SupabaseClient, input: NewEnvelope): Promise<CreatedEnvelope> {
  const { data: envelope, error } = await supabase
    .from("envelopes")
    .insert({
      title: input.title.trim(),
      message: input.message ?? null,
      document_content: input.documentContent,
      organization_id: input.orgId,
      created_by: input.creator.id,
      status: "draft",
      ...(input.lpSessionId ? { lp_session_id: input.lpSessionId } : {}),
    })
    .select("id")
    .single();
  if (error || !envelope) {
    console.error("createEnvelope: envelope insert", error);
    // The unique index: this LP already has a live agreement.
    if (error?.code === "23505") return { ok: false, status: 409, error: "This LP already has a subscription agreement in progress." };
    return { ok: false, status: 500, error: error?.message ?? "Failed to create envelope" };
  }
  const envelopeId = (envelope as { id: string }).id;

  const { data: inserted, error: recErr } = await supabase
    .from("envelope_recipients")
    .insert(input.recipients.map((r, i) => ({ envelope_id: envelopeId, name: r.name, email: r.email, routing_order: r.routingOrder ?? i + 1 })))
    .select("id, name, email, routing_order, signing_token");
  if (recErr || !inserted) {
    console.error("createEnvelope: recipients", recErr);
    return { ok: false, status: 500, error: recErr?.message ?? "Failed to insert recipients" };
  }

  // The account owner signs last.
  const ownerName = input.creator.name || (input.creator.email ?? "Account owner").split("@")[0];
  const { error: ownerErr } = await supabase.from("envelope_recipients").insert({
    envelope_id: envelopeId,
    name: ownerName,
    email: input.creator.email ?? "",
    routing_order: 1000,
    role: "owner",
  });
  if (ownerErr) {
    console.error("createEnvelope: owner", ownerErr);
    return { ok: false, status: 500, error: "Failed to add the countersigner" };
  }

  let bytes = input.pdfBytes;
  if (bytes) {
    if (!isPdfBytes(bytes)) return { ok: false, status: 400, error: "That file is not a PDF" };
  } else {
    bytes = await buildDocumentPdf({ title: input.title.trim(), text: input.documentContent, signaturePage: input.signaturePage });
  }
  const stored = await storeEnvelopePdf(envelopeId, bytes);
  if (!stored) return { ok: false, status: 400, error: "Could not store the document (is it over 25 MB?)" };
  await supabase.from("envelopes").update({ pdf_storage_key: stored.key, document_sha256: stored.sha256 }).eq("id", envelopeId);

  await supabase.from("envelope_events").insert({ envelope_id: envelopeId, event_type: "created", metadata: { actor: input.creator.id } });

  return { ok: true, envelopeId, recipients: inserted as never };
}
