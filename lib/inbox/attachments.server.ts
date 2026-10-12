// lib/inbox/attachments.server.ts
// Uploading, listing and sending the files on an inbox reply.
//
//   ticket     — a signed upload URL for one file, so the browser sends the
//                bytes straight to Storage (a Server Action body is capped near
//                a megabyte; a deck is not).
//   documents  — library documents with an uploaded file, to attach as-is.
//   room links — a data-room link for one document, minted with the firm's
//                usual gates (email capture, watermark) for the composer to put
//                in the message text.
//   outgoing   — at send time: each file read back from Storage (never trusted
//                from the client), attached while the message stays under
//                Gmail's limit, and sent as an expiring download link after.
//
// Every read is scoped to the caller's org: an upload path must carry the org
// prefix, a document must belong to the org.

import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET, isUploadedFile } from "@/lib/document-files";
import { MAX_ATTACHMENT_BYTES, type EmailAttachment } from "@/lib/email";
import { insertShare, shareUrl } from "@/lib/data-room-shares.server";
import { loadMeetingDocs } from "@/lib/meetings/doc-share.server";
import {
  ATTACHMENT_LINK_DAYS,
  INBOX_ATTACHMENT_BUCKET,
  MAX_ATTACHMENT_FILE_BYTES,
  attachmentPath,
  isOrgAttachmentPath,
  splitBySize,
  type AttachmentRef,
  type SentAttachment,
} from "@/lib/inbox/attachments";

type Client = SupabaseClient<Database>;

export type AttachmentTicket =
  | { ok: true; path: string; token: string; signedUrl: string }
  | { ok: false; error: string };

export async function createAttachmentTicket(
  orgId: string,
  input: { name: string; size: number },
): Promise<AttachmentTicket> {
  if (!hasSupabaseServiceEnv()) return { ok: false, error: "File uploads are not available here." };
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "That file has no name." };
  if (!(input.size > 0)) return { ok: false, error: "That file is empty." };
  if (input.size > MAX_ATTACHMENT_FILE_BYTES) {
    return { ok: false, error: "That file is over 100 MB. Share it as a data room link instead." };
  }
  const path = attachmentPath(orgId, randomUUID(), name);
  const { data, error } = await createServiceClient().storage.from(INBOX_ATTACHMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Couldn't start the upload. Try again." };
  return { ok: true, path, token: data.token, signedUrl: data.signedUrl };
}

export interface AttachableDocument {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

/** Library documents backed by an uploaded file, newest first. */
export async function listAttachableDocuments(client: Client, orgId: string): Promise<AttachableDocument[]> {
  const { data } = await client
    .from("documents")
    .select("id, name, storage_key, mime_type, size_bytes")
    .eq("organization_id", orgId)
    .not("storage_key", "is", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as Array<{ id: string; name: string; storage_key: string | null; mime_type: string | null; size_bytes: number | null }>)
    .filter((d) => isUploadedFile(d.storage_key))
    .map((d) => ({ id: d.id, name: d.name, size: d.size_bytes ?? 0, mimeType: d.mime_type ?? "application/octet-stream" }));
}

/** The firm's data-room documents that can be shared by link. */
export async function listRoomDocuments(orgId: string) {
  const { docs } = await loadMeetingDocs(orgId);
  return docs.filter((d) => !d.blocked).map((d) => ({ id: d.id, name: d.name, roomName: d.roomName }));
}

export type RoomLink = { ok: true; url: string; name: string } | { ok: false; error: string };

/**
 * A data-room link to one document, for the message the composer is writing.
 * The authed client mints it, so the share's own write policy (org writers
 * only) still applies. Email capture and a watermark are on, as for a link
 * handed over in a meeting: the document is leaving the firm.
 */
export async function mintRoomLink(
  client: Client,
  input: { orgId: string; userId: string; documentId: string; label: string },
): Promise<RoomLink> {
  const { docs } = await loadMeetingDocs(input.orgId).catch(() => ({ docs: [] as Awaited<ReturnType<typeof loadMeetingDocs>>["docs"] }));
  const doc = docs.find((d) => d.id === input.documentId && !d.blocked);
  if (!doc) {
    return { ok: false, error: "That document can't be shared by link (it may be a draft or not in a data room)." };
  }
  const minted = await insertShare(client, {
    orgId: input.orgId,
    userId: input.userId,
    roomId: doc.roomId,
    documentId: doc.id,
    label: input.label.slice(0, 120),
    expiresInDays: 14,
    requireEmail: true,
    requireNda: false,
    ndaText: null,
    password: null,
    recipientEmail: null,
    notifyOnOpen: false,
    allowedSections: null,
    allowDownload: true,
    watermark: true,
  });
  if (!minted) return { ok: false, error: "Couldn't create the link. You may not have permission to share." };
  return { ok: true, url: shareUrl(minted.token), name: doc.name };
}

interface Resolved {
  name: string;
  size: number;
  mimeType: string;
  bucket: string;
  path: string;
}

/** Each file's real place and size, checked against the org; null where a ref is not the org's. */
async function resolveRefs(orgId: string, refs: readonly AttachmentRef[]): Promise<Array<Resolved | null>> {
  const svc = createServiceClient() as unknown as Client;
  const out: Array<Resolved | null> = [];
  const docIds = refs.filter((r) => r.kind === "document").map((r) => (r as { documentId: string }).documentId);
  const docs = new Map<string, { name: string; storage_key: string; mime_type: string | null; size_bytes: number | null }>();
  if (docIds.length) {
    const { data } = await svc
      .from("documents")
      .select("id, name, storage_key, mime_type, size_bytes")
      .eq("organization_id", orgId)
      .in("id", docIds);
    for (const d of (data ?? []) as Array<{ id: string; name: string; storage_key: string | null; mime_type: string | null; size_bytes: number | null }>) {
      if (d.storage_key && isUploadedFile(d.storage_key)) docs.set(d.id, { ...d, storage_key: d.storage_key });
    }
  }
  for (const r of refs) {
    if (r.kind === "upload") {
      if (!isOrgAttachmentPath(orgId, r.path)) {
        out.push(null);
        continue;
      }
      out.push({ name: r.name, size: r.size, mimeType: r.mimeType, bucket: INBOX_ATTACHMENT_BUCKET, path: r.path });
    } else {
      const d = docs.get(r.documentId);
      if (!d) {
        out.push(null);
        continue;
      }
      out.push({
        name: r.name || d.name,
        size: d.size_bytes ?? r.size,
        mimeType: d.mime_type ?? r.mimeType,
        bucket: DOCUMENT_BUCKET,
        path: d.storage_key,
      });
    }
  }
  return out;
}

export interface OutgoingFiles {
  attachments: EmailAttachment[];
  links: Array<{ name: string; size: number; url: string }>;
  sent: SentAttachment[];
  /** Files that could not be read or linked at all, by name. */
  missing: string[];
}

/** The files a message carries, ready to send: attached under the limit, linked over it. */
export async function prepareOutgoingFiles(orgId: string, refs: readonly AttachmentRef[]): Promise<OutgoingFiles> {
  const out: OutgoingFiles = { attachments: [], links: [], sent: [], missing: [] };
  if (!refs.length) return out;
  if (!hasSupabaseServiceEnv()) {
    out.missing = refs.map((r) => r.name);
    return out;
  }
  const all = await resolveRefs(orgId, refs);
  all.forEach((r, i) => {
    if (!r) out.missing.push(refs[i].name);
  });
  const resolved = all.filter((r): r is Resolved => r !== null);
  const storage = createServiceClient().storage;
  const { attach, link } = splitBySize(resolved, MAX_ATTACHMENT_BYTES);
  // The split ran on the sizes the composer reported; the bytes read back are
  // the truth, so the running total is re-checked against them.
  let total = 0;
  for (const f of attach) {
    const { data, error } = await storage.from(f.bucket).download(f.path);
    if (error || !data) {
      link.push(f);
      continue;
    }
    const content = new Uint8Array(await data.arrayBuffer());
    if (total + content.byteLength > MAX_ATTACHMENT_BYTES) {
      link.push({ ...f, size: content.byteLength });
      continue;
    }
    total += content.byteLength;
    out.attachments.push({ filename: f.name, contentType: f.mimeType, content });
    out.sent.push({ name: f.name, size: content.byteLength, delivery: "attached" });
  }
  for (const f of link) {
    const { data } = await storage
      .from(f.bucket)
      .createSignedUrl(f.path, ATTACHMENT_LINK_DAYS * 86_400, { download: f.name });
    if (!data?.signedUrl) {
      out.missing.push(f.name);
      continue;
    }
    out.links.push({ name: f.name, size: f.size, url: data.signedUrl });
    out.sent.push({ name: f.name, size: f.size, delivery: "link" });
  }
  return out;
}
