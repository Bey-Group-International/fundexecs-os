// lib/signing/executed-envelope.server.ts
//
// The signed copy of an envelope: every signer's answers and signature stamped on the document,
// the signature page, and (once everyone has signed) the digital seal. A fully signed copy is
// built once, kept, and served as the same file to everyone; a partly signed one is built
// fresh each time because it is still changing and is never kept.
import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSignedPdf } from "@/lib/signing/executed-pdf.server";
import { stampBlocks, type StampField } from "@/lib/signing/stamp.server";
import { sealConfigured, sealPdf } from "@/lib/signing/seal.server";
import { loadEnvelopePdf, loadExecutedPdf, storeExecutedPdf } from "@/lib/envelope-pdf.server";
import { formatBlockDateTime } from "@/lib/signing/blocks";

export interface EnvelopeCopy {
  pdf: Uint8Array;
  title: string;
  /** Every party has signed. */
  executed: boolean;
  /** The bytes came from the kept copy. */
  kept: boolean;
}

async function buildCopy(db: SupabaseClient, id: string): Promise<(Omit<EnvelopeCopy, "kept"> & { sealedOk: boolean }) | null> {
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
  // A copy that should be sealed but could not be must not be kept: it would stay unsealed for good.
  return { pdf: out.pdf, title: envelope.title, executed, sealedOk: !executed || out.sealed || !sealConfigured() };
}


/**
 * The envelope's signed copy. A fully signed one is read from where it was kept; if it was not
 * built yet it is built, kept, and then read back, so two people asking at the same moment still
 * get the same file. Null if nothing has been signed yet.
 */
export async function getEnvelopeCopy(db: SupabaseClient, id: string): Promise<EnvelopeCopy | null> {
  const { data: env } = await db.from("envelopes").select("title, status").eq("id", id).maybeSingle();
  const head = env as { title: string; status: string } | null;
  if (!head) return null;

  if (head.status === "completed") {
    const kept = await loadExecutedPdf(id);
    if (kept) return { pdf: kept, title: head.title, executed: true, kept: true };
  }

  const built = await buildCopy(db, id);
  if (!built) return null;
  if (built.executed && built.sealedOk) {
    if (await storeExecutedPdf(id, built.pdf)) return { pdf: built.pdf, title: built.title, executed: true, kept: true };
    // Someone else kept it first (or the write failed): serve theirs, so everyone has one file.
    const theirs = await loadExecutedPdf(id);
    if (theirs) return { pdf: theirs, title: built.title, executed: true, kept: true };
  }
  return { pdf: built.pdf, title: built.title, executed: built.executed, kept: false };
}

/** Build and keep the executed copy now (when the last person signs), so the first download is instant. */
export async function keepExecutedCopy(db: SupabaseClient, id: string): Promise<void> {
  await getEnvelopeCopy(db, id);
}
