"use server";

// Uploading a file into the library.
//
// The browser never sends the file through the app. It asks for a ticket, PUTs
// the bytes straight to Storage with it, then asks the server to finalize —
// three steps instead of one, for two reasons that matter at institutional file
// sizes: a Server Action body is capped around a megabyte (a PPM is not), and a
// 60 MB round trip through a serverless function is paid for twice.
//
// The consequence is that anything the browser says about a file before the
// upload is a claim. `createUploadTicket` decides what path may be written;
// `finalizeUpload` re-reads the object from Storage and writes the real size
// and type onto the row. Nothing the client sends is stored unchecked.
//
// Like everything else in this module, uploading publishes nothing: a file
// reaches an outside reader only by being published into a data room.
import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import {
  DOCUMENT_BUCKET,
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  documentNameFromFile,
  documentObjectPath,
  formatBytes,
  isDocumentObjectPath,
  isUploadedFile,
  type UploadOutcome,
  type UploadTicket,
} from "@/lib/document-files";
import {
  removeDocumentObjects,
  statDocumentObject,
} from "@/lib/document-storage.server";
import type { Document } from "@/lib/supabase/database.types";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));
// A "use server" module may export only async functions, so these stay local.
const LIBRARY = "/build/documents";
const ROOMS = "/build/data_room";

function revalidateBoth(docId?: string): void {
  revalidatePath(LIBRARY);
  revalidatePath(ROOMS);
  if (docId) revalidatePath(`/document/${docId}`);
}

/**
 * Step 1 — mint a one-shot ticket for one file.
 *
 * Creating the document row here rather than at finalize time is what gives the
 * object a home: the path is `${org}/${document}/…`, so every version of a
 * document shares a prefix and deleting the document takes its bytes with it.
 * The cost is a row that exists before its file does; `abandonUpload` clears
 * one up when the transfer fails, and the row carries no file until finalize,
 * so a stray one is visible as an empty draft rather than as a broken link.
 *
 * Pass `documentId` to replace the file on an existing document — the same
 * ticket path, one version deeper.
 */
export async function createUploadTicket(input: {
  section: string;
  fileName: string;
  size: number;
  mimeType?: string;
  documentId?: string;
}): Promise<UploadTicket> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Sign in to upload." };
  if (!hasSupabaseServiceEnv()) return { ok: false, error: "File storage is not configured." };

  const check = checkUploadCandidate({
    name: input.fileName,
    size: input.size,
    type: input.mimeType,
  });
  if (!check.ok) return { ok: false, error: check.reason };

  const supabase = await createServerClient();
  const sectionKey = SECTION_KEYS.has(input.section) ? input.section : "other";

  let documentId = input.documentId;
  if (documentId) {
    // Replacing an existing document's file. The RLS-scoped read proves the
    // document is this org's; the update below proves the caller may write it.
    const { data } = await supabase
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That document no longer exists." };
  } else {
    // A plain insert under RLS: `documents_write` (0010_rls) requires a writer
    // role, so a viewer is refused here and never reaches the ticket.
    const { data, error } = await supabase
      .from("documents")
      .insert({
        organization_id: ctx.orgId,
        name: documentNameFromFile(input.fileName),
        doc_type: sectionKey,
        status: "draft",
        uploaded_by: ctx.userId,
      })
      .select("id")
      .maybeSingle();
    if (error || !data?.id) return { ok: false, error: "Could not add that document." };
    documentId = data.id as string;
  }

  const path = documentObjectPath(ctx.orgId, documentId, crypto.randomUUID(), check.ext);
  const { data: signed, error: signError } = await createServiceClient()
    .storage.from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (signError || !signed?.token) {
    // Don't strand a row that will never get a file.
    if (!input.documentId) {
      await supabase.from("documents").delete().eq("id", documentId).eq("organization_id", ctx.orgId);
    }
    return { ok: false, error: "Could not start that upload." };
  }

  return { ok: true, documentId, path, token: signed.token };
}

/**
 * Step 3 — attach an uploaded object to its document.
 *
 * Everything the browser claimed is re-derived here from Storage itself. An
 * object that is missing, empty, or over the ceiling is deleted rather than
 * recorded, so a document never points at bytes that were not accepted.
 */
export async function finalizeUpload(input: {
  documentId: string;
  path: string;
  /** Original filename, kept only to name a fresh document. */
  fileName?: string;
}): Promise<UploadOutcome> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Sign in to upload." };

  if (!isDocumentObjectPath(input.path, ctx.orgId, input.documentId)) {
    return { ok: false, error: "That upload does not belong to this document." };
  }

  const supabase = await createServerClient();
  const { data: row } = await supabase
    .from("documents")
    .select("*")
    .eq("id", input.documentId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = row as Document | null;
  if (!doc) return { ok: false, error: "That document no longer exists." };

  const object = await statDocumentObject(input.path);
  if (!object) return { ok: false, error: "That file did not finish uploading." };
  if (object.size <= 0 || object.size > MAX_UPLOAD_BYTES) {
    await removeDocumentObjects([input.path]);
    return {
      ok: false,
      error:
        object.size <= 0
          ? "That file arrived empty."
          : `That file is ${formatBytes(object.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    };
  }

  // Replacing a file is a new version of the same document, exactly as saving
  // inline content is — so snapshot what is being replaced before overwriting
  // it. The old object is left in the bucket, which is what makes restoring a
  // version a pointer swap rather than a re-upload.
  if (doc.storage_key || doc.content) {
    await supabase.from("document_versions").insert({
      document_id: doc.id,
      organization_id: ctx.orgId,
      name: doc.name,
      content: doc.content ?? null,
      storage_key: doc.storage_key ?? null,
      mime_type: doc.mime_type ?? null,
      size_bytes: doc.size_bytes ?? null,
      saved_by: ctx.userId,
    } as never);
  }

  const { error } = await supabase
    .from("documents")
    .update({
      storage_key: input.path,
      // Trust Storage's own reading of the object over the browser's.
      mime_type: object.mimeType ?? null,
      size_bytes: object.size,
    })
    .eq("id", input.documentId)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: "Could not attach that file." };

  revalidateBoth(input.documentId);
  return { ok: true };
}

/**
 * Clean up after a transfer that never landed.
 *
 * Removes the object if any of it made it, and removes the document row too —
 * but only when the row is still the empty shell `createUploadTicket` made. A
 * failed re-upload over an existing document must leave that document exactly
 * as it was.
 */
export async function abandonUpload(input: {
  documentId: string;
  path?: string;
}): Promise<UploadOutcome> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Sign in to upload." };

  if (input.path && isDocumentObjectPath(input.path, ctx.orgId, input.documentId)) {
    await removeDocumentObjects([input.path]);
  }

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("storage_key, content")
    .eq("id", input.documentId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Pick<Document, "storage_key" | "content"> | null;
  if (doc && !doc.storage_key && !doc.content) {
    await supabase.from("documents").delete().eq("id", input.documentId).eq("organization_id", ctx.orgId);
  }
  revalidateBoth();
  return { ok: true };
}

/**
 * Detach an uploaded file from its document without deleting the document.
 *
 * The bytes go; the row, its name, its section, and any written content stay.
 * Used when a file was filed in the wrong place and is about to be replaced.
 */
export async function removeDocumentFile(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("storage_key")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const key = (data as { storage_key: string | null } | null)?.storage_key ?? null;
  if (!isUploadedFile(key)) return;

  const { error } = await supabase
    .from("documents")
    .update({ storage_key: null, mime_type: null, size_bytes: null })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  // Drop the bytes only once the row no longer points at them, so a failed
  // update can never leave a document referencing an object that is gone.
  if (!error && key) await removeDocumentObjects([key]);
  revalidateBoth(id);
}
