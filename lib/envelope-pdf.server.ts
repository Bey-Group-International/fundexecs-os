// lib/envelope-pdf.server.ts
//
// The document an envelope is signed on: a PDF kept in the documents bucket under
// the envelope's own path, with its SHA-256 on the envelope row. Reads and writes go
// through the service role; callers check who may see it first.
import "server-only";
import { createHash } from "crypto";
import { DOCUMENT_BUCKET } from "@/lib/document-files";
import { createServiceClient } from "@/lib/supabase/server";

/** Largest PDF accepted for signing. */
export const MAX_ENVELOPE_PDF_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export const envelopePdfKey = (envelopeId: string) => `envelopes/${envelopeId}.pdf`;
export const isPdfBytes = (b: Uint8Array) => b.length > 8 && PDF_MAGIC.every((m, i) => b[i] === m);
export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function storeEnvelopePdf(envelopeId: string, bytes: Uint8Array): Promise<{ key: string; sha256: string } | null> {
  if (!isPdfBytes(bytes) || bytes.length > MAX_ENVELOPE_PDF_BYTES) return null;
  const key = envelopePdfKey(envelopeId);
  const { error } = await createServiceClient().storage.from(DOCUMENT_BUCKET).upload(key, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  return error ? null : { key, sha256: sha256Hex(bytes) };
}

export async function loadEnvelopePdf(key: string): Promise<Uint8Array | null> {
  const { data, error } = await createServiceClient().storage.from(DOCUMENT_BUCKET).download(key);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Where the finished, fully signed copy is kept once it has been built. */
export const executedPdfKey = (envelopeId: string) => `envelopes/${envelopeId}-executed.pdf`;

/** The kept executed copy, or null if it has not been built yet. */
export async function loadExecutedPdf(envelopeId: string): Promise<Uint8Array | null> {
  return loadEnvelopePdf(executedPdfKey(envelopeId));
}

/**
 * Keep the executed copy. It is written once and never replaced, so every person who downloads
 * it gets the same bytes; `false` if one is already there (or could not be written).
 */
export async function storeExecutedPdf(envelopeId: string, bytes: Uint8Array): Promise<boolean> {
  if (!isPdfBytes(bytes)) return false;
  const { error } = await createServiceClient().storage.from(DOCUMENT_BUCKET).upload(executedPdfKey(envelopeId), bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  return !error;
}
