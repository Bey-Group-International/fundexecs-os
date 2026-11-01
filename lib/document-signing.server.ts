// lib/document-signing.server.ts
//
// A signature on one file in a data room (say, an NDA uploaded as a PDF).
//
// Same standard as the link-level NDA (lib/nda-signing.server.ts): the server
// decides everything the record says. The time is its own clock, the signer's
// email comes from the reader's gate pass, and what was signed is the file's
// SHA-256 as it stands now, kept on the row. The browser supplies only the
// typed name and the "I agree" tick.
import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_BUCKET, isUploadedFile } from "@/lib/document-files";
import { escapeHtml, sendEmail } from "@/lib/email";
import { selectInBatches } from "@/lib/supabase/batch";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { formatSignedAt } from "@/lib/nda";
import type { Document } from "@/lib/supabase/database.types";

// The signature tables are read through narrow shapes rather than the
// generated types, as the NDA signing module does.
type Client = SupabaseClient;

const GENERIC = "We couldn't record your signature. Please try again.";
/** Largest file we will fingerprint in memory. */
const MAX_HASH_BYTES = 100 * 1024 * 1024;

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * Fingerprint of the file as it stands: the bytes for an uploaded file, the
 * text for a written document, the address for an external link. Null when an
 * uploaded file cannot be read, so we never record a signature over nothing.
 */
export async function fingerprintDocument(
  client: Client,
  doc: Pick<Document, "storage_key" | "content" | "name">,
): Promise<string | null> {
  if (doc.storage_key && isUploadedFile(doc.storage_key)) {
    const { data: blob, error } = await client.storage.from(DOCUMENT_BUCKET).download(doc.storage_key);
    if (error || !blob || blob.size > MAX_HASH_BYTES) return null;
    return sha256(new Uint8Array(await blob.arrayBuffer()));
  }
  return sha256(doc.storage_key ?? doc.content ?? doc.name);
}

/** Which of these documents this reader (by email) has signed on this link. */
export async function signedDocumentIds(
  client: Client,
  shareId: string,
  email: string | null,
  documentIds: string[],
): Promise<Set<string>> {
  if (!email || documentIds.length === 0) return new Set();
  // Batched for the same reason as the room's document read: a long `.in()`
  // overflows the URL, the read errors, and an errored read here would lock a
  // reader out of files they have already signed.
  const { data } = await selectInBatches<{ document_id: string }>(documentIds, (batch) =>
    client
      .from("data_room_document_signatures")
      .select("document_id")
      .eq("share_id", shareId)
      .ilike("signer_email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .in("document_id", batch) as unknown as PromiseLike<{ data: { document_id: string }[] | null; error: { message: string } | null }>,
  );
  return new Set((data ?? []).map((r) => r.document_id));
}

export type SignDocumentResult =
  | { ok: true; signatureId: string; orgId: string }
  | { ok: false; error: string };

/** Record a reader's signature on a file that requires one. */
export async function signDocument(
  client: Client,
  input: {
    shareId: string;
    roomId: string;
    orgId: string;
    doc: Pick<Document, "id" | "name" | "storage_key" | "content">;
    signerName: string;
    agreed: boolean;
    email: string | null;
    ipHint: string | null;
    now?: Date;
  },
): Promise<SignDocumentResult> {
  const name = input.signerName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Type your full name to sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };
  if (!input.agreed) return { ok: false, error: "Tick the box to confirm you agree." };
  if (!input.email) return { ok: false, error: "Enter your email first, then sign." };

  const hash = await fingerprintDocument(client, input.doc);
  if (!hash) return { ok: false, error: "This document is temporarily unavailable. Please try again." };

  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const { data: row, error } = await client
    .from("data_room_document_signatures")
    .insert({
      organization_id: input.orgId,
      room_id: input.roomId,
      document_id: input.doc.id,
      share_id: input.shareId,
      signer_name: name,
      signer_email: email,
      signed_at: now.toISOString(),
      ip_hint: input.ipHint,
      file_name: input.doc.name,
      file_sha256: hash,
      agreed: true,
    })
    .select("id")
    .maybeSingle();
  const id = (row as { id: string } | null)?.id;
  if (id) return { ok: true, signatureId: id, orgId: input.orgId };

  // Signed already on this link (unique index): the file is unlocked, so treat
  // a repeat as success rather than an error the reader can do nothing about.
  if (error?.code === "23505") {
    const { data: existing } = await client
      .from("data_room_document_signatures")
      .select("id")
      .eq("share_id", input.shareId)
      .eq("document_id", input.doc.id)
      .ilike("signer_email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .maybeSingle();
    const eid = (existing as { id: string } | null)?.id;
    if (eid) return { ok: true, signatureId: eid, orgId: input.orgId };
  }
  return { ok: false, error: GENERIC };
}

interface SignatureRow {
  id: string;
  organization_id: string;
  room_id: string;
  document_id: string;
  share_id: string;
  signer_name: string;
  signer_email: string;
  signed_at: string;
  file_name: string;
  file_sha256: string;
  copy_sent_at: string | null;
}

/**
 * Everything that follows a signature, best effort (the signature stands
 * whether or not any of it succeeds): a receipt to the signer, a note to the
 * link's creator, and an entry on the signer's CRM timeline when their email
 * matches a contact exactly.
 */
export async function afterDocumentSigned(client: Client, signatureId: string): Promise<void> {
  const { data } = await client
    .from("data_room_document_signatures")
    .select(
      "id, organization_id, room_id, document_id, share_id, signer_name, signer_email, signed_at, file_name, file_sha256, copy_sent_at",
    )
    .eq("id", signatureId)
    .maybeSingle();
  const sig = data as SignatureRow | null;
  if (!sig) return;

  const [{ data: orgData }, { data: roomData }, { data: shareData }] = await Promise.all([
    client.from("organizations").select("name").eq("id", sig.organization_id).maybeSingle(),
    client.from("data_rooms").select("name").eq("id", sig.room_id).maybeSingle(),
    client.from("data_room_shares").select("label, created_by").eq("id", sig.share_id).maybeSingle(),
  ]);
  const orgName = (orgData as { name: string } | null)?.name ?? "the fund";
  const roomName = (roomData as { name: string } | null)?.name ?? "the data room";
  const share = shareData as { label: string | null; created_by: string | null } | null;
  const when = formatSignedAt(sig.signed_at);

  // 1. Receipt to the signer.
  if (!sig.copy_sent_at) {
    const sent = await sendEmail({
      orgId: sig.organization_id,
      to: { name: sig.signer_name, email: sig.signer_email },
      subject: `You signed ${sig.file_name} — ${orgName}`,
      htmlBody: `<p>Hi ${escapeHtml(sig.signer_name)},</p>
<p>This confirms you signed <strong>${escapeHtml(sig.file_name)}</strong> in <strong>${escapeHtml(roomName)}</strong> (${escapeHtml(orgName)}) on ${escapeHtml(when)}.</p>
<p style="font-size:12px;color:#666">Fingerprint of the file you signed (SHA-256):<br><code>${escapeHtml(sig.file_sha256)}</code></p>`,
      allowFallback: true,
    }).catch(() => ({ ok: false }));
    if (sent.ok) {
      await client
        .from("data_room_document_signatures")
        .update({ copy_sent_at: new Date().toISOString() })
        .eq("id", sig.id)
        .then(() => undefined, () => undefined);
    }
  }

  // 2. Tell the link's creator.
  if (share?.created_by) {
    const { data: u } = await client.auth.admin.getUserById(share.created_by).catch(() => ({ data: null }));
    const to = (u as { user?: { email?: string } } | null)?.user?.email;
    if (to) {
      await sendEmail({
        orgId: sig.organization_id,
        to: { name: "", email: to },
        subject: `${sig.signer_name} signed ${sig.file_name}`,
        htmlBody: `<p><strong>${escapeHtml(sig.signer_name)}</strong> (${escapeHtml(sig.signer_email)}) signed <strong>${escapeHtml(sig.file_name)}</strong> in ${escapeHtml(roomName)}${share.label ? ` via “${escapeHtml(share.label)}”` : ""} on ${escapeHtml(when)}.</p>`,
      }).catch(() => undefined);
    }
  }

  // 3. CRM timeline, exact email match only (the CRM's own rule).
  const { crmMatches } = await import("@/lib/data-room-crm.server");
  const matches = await crmMatches(client as never, sig.organization_id, [sig.signer_email]).catch(() => null);
  const m = matches?.get(normalizeEmail(sig.signer_email));
  if (m?.contactId) {
    await client
      .from("network_activities")
      .insert({
        organization_id: sig.organization_id,
        contact_id: m.contactId,
        investor_id: m.investorId,
        activity_type: "document",
        direction: "inbound",
        subject: `Signed ${sig.file_name}`,
        body: `Signed ${sig.file_name} in ${roomName} on ${when}.`,
        occurred_at: sig.signed_at,
        is_system: true,
        metadata: { source: "data_room_signature", room_id: sig.room_id, document_id: sig.document_id, signature_id: sig.id },
      })
      .then(() => undefined, () => undefined);
  }
}
