// lib/signing/seal.server.ts
//
// Seals an executed PDF with a certificate-based digital signature (PAdES-style
// detached CMS over the whole file), so a reader such as Acrobat reports whether
// it was altered after signing. The certificate is a deploy secret:
//   PDF_SEAL_P12_BASE64      the .p12/.pfx file, base64
//   PDF_SEAL_P12_PASSPHRASE  its passphrase (may be empty)
// Without them the PDF is returned unsealed and says so; the signatures, hashes
// and audit rows still stand, but the file itself is not tamper-evident.
import "server-only";
import { PDFDocument } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import signpdf from "@signpdf/signpdf";

export function sealConfigured(): boolean {
  return Boolean(process.env.PDF_SEAL_P12_BASE64);
}

export interface SealResult {
  pdf: Uint8Array;
  sealed: boolean;
}

export async function sealPdf(
  pdf: Uint8Array,
  meta: { reason: string; name?: string; contactInfo?: string },
  now: Date = new Date(),
): Promise<SealResult> {
  const p12 = process.env.PDF_SEAL_P12_BASE64;
  if (!p12) return { pdf, sealed: false };
  try {
    const doc = await PDFDocument.load(pdf);
    pdflibAddPlaceholder({
      pdfDoc: doc,
      reason: meta.reason,
      contactInfo: meta.contactInfo ?? "support@fundexecs.com",
      name: meta.name ?? "FundExecs",
      location: "FundExecs OS",
      signingTime: now,
    });
    // Signing needs the plain cross-reference table, not object streams.
    const withPlaceholder = await doc.save({ useObjectStreams: false });
    const signer = new P12Signer(Buffer.from(p12, "base64"), {
      passphrase: process.env.PDF_SEAL_P12_PASSPHRASE ?? "",
    });
    const signed = await signpdf.sign(withPlaceholder, signer, now);
    return { pdf: new Uint8Array(signed), sealed: true };
  } catch (err) {
    // A seal that cannot be applied must not block delivering the executed copy.
    console.error("[pdf-seal] could not seal", err instanceof Error ? err.message : err);
    return { pdf, sealed: false };
  }
}
