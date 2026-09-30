// lib/document-text.server.ts
//
// The text layer of an uploaded library file: what Earn reads, and what the
// in-app viewer renders for Office formats.
//
// Extraction happens once per stored object and is cached in `document_texts`
// keyed by storage key, so replacing a file invalidates its text for free. It is
// kicked off after an upload finalizes and, if that missed (a cold deploy, an
// older upload), done lazily on first read.
//
// Callers are responsible for having authorized the reader. This module reads
// with the service client because the public data room viewer has no session.
import "server-only";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET, fileExtension, isExtractable } from "@/lib/document-files";
import { extractDocx, extractPptx, extractXlsx, type OfficePreview } from "@/lib/ooxml";

/** Files larger than this are not pulled into memory to be read. */
export const MAX_EXTRACT_BYTES = 80 * 1024 * 1024;
/** Stored text ceiling — far more than any prompt will take. */
const MAX_STORED_CHARS = 500_000;

export type TextStatus = "ok" | "empty" | "unsupported" | "failed";

export interface DocumentText {
  status: TextStatus;
  text: string;
  preview: OfficePreview | null;
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[])
    .map((page, i) => `[Page ${i + 1}]\n${page.trim()}`)
    .join("\n\n");
}

/** Pure dispatch on extension — exported for tests. */
export async function extractFromBytes(
  storageKey: string,
  bytes: Uint8Array,
): Promise<DocumentText> {
  const ext = fileExtension(storageKey);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text = "";
  let preview: OfficePreview | null = null;
  switch (ext) {
    case ".pdf":
      text = await readPdf(bytes);
      break;
    case ".docx":
      ({ text, preview } = extractDocx(buf));
      break;
    case ".xlsx":
      ({ text, preview } = extractXlsx(buf));
      break;
    case ".pptx":
      ({ text, preview } = extractPptx(buf));
      break;
    case ".txt":
    case ".md":
    case ".csv":
      text = buf.toString("utf8");
      break;
    default:
      return { status: "unsupported", text: "", preview: null };
  }
  // A scanned PDF has pages but no text layer; say so rather than store blanks.
  const meaningful = text.replace(/\[Page \d+\]/g, "").trim();
  return {
    status: meaningful ? "ok" : "empty",
    text: text.slice(0, MAX_STORED_CHARS),
    preview,
  };
}

/**
 * Extract and cache the text of one stored object. Never throws: a failure is
 * recorded as `failed` so the viewer can fall back and Earn can say it could not
 * read the file, rather than an upload erroring after it already succeeded.
 */
export async function extractAndStoreDocumentText(input: {
  orgId: string;
  documentId: string;
  storageKey: string;
}): Promise<DocumentText | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const db = createServiceClient();
  let result: DocumentText;
  if (!isExtractable(input.storageKey)) {
    result = { status: "unsupported", text: "", preview: null };
  } else {
    try {
      const { data, error } = await db.storage.from(DOCUMENT_BUCKET).download(input.storageKey);
      if (error || !data) throw error ?? new Error("missing object");
      if (data.size > MAX_EXTRACT_BYTES) {
        result = { status: "unsupported", text: "", preview: null };
      } else {
        result = await extractFromBytes(input.storageKey, new Uint8Array(await data.arrayBuffer()));
      }
    } catch (err) {
      console.warn("document text extraction failed", input.documentId, err);
      result = { status: "failed", text: "", preview: null };
    }
  }
  await db.from("document_texts").upsert(
    {
      document_id: input.documentId,
      organization_id: input.orgId,
      storage_key: input.storageKey,
      status: result.status,
      text: result.text,
      preview: result.preview as never,
      char_count: result.text.length,
      extracted_at: new Date().toISOString(),
    } as never,
    { onConflict: "document_id" },
  );
  return result;
}

/**
 * The cached text for a document's CURRENT file, extracting on a miss. Returns
 * null when the document has no uploaded file.
 */
export async function getDocumentText(input: {
  orgId: string;
  documentId: string;
  storageKey: string | null;
}): Promise<DocumentText | null> {
  if (!input.storageKey || !hasSupabaseServiceEnv()) return null;
  const db = createServiceClient();
  const { data } = await db
    .from("document_texts")
    .select("storage_key, status, text, preview")
    .eq("document_id", input.documentId)
    .eq("organization_id", input.orgId)
    .maybeSingle();
  const row = data as { storage_key: string; status: TextStatus; text: string; preview: OfficePreview | null } | null;
  if (row && row.storage_key === input.storageKey && row.status !== "failed") {
    return { status: row.status, text: row.text, preview: row.preview };
  }
  return extractAndStoreDocumentText({
    orgId: input.orgId,
    documentId: input.documentId,
    storageKey: input.storageKey,
  });
}
