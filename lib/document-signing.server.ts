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
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_BUCKET, isUploadedFile } from "@/lib/document-files";
import { escapeHtml, sendEmail } from "@/lib/email";
import { selectInBatches } from "@/lib/supabase/batch";
import { DataRoomReadError } from "@/lib/data-room-errors";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { formatSignedAt } from "@/lib/nda";
import { SITE_URL } from "@/lib/site";
import { parseSignaturePng } from "@/lib/signing/signature-image";
import { buildSignedPdf } from "@/lib/signing/executed-pdf.server";
import { sealPdf } from "@/lib/signing/seal.server";
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
  // overflows the URL and the read errors. An errored read is not "nothing
  // signed": it would show a reader the signature form again for a file they
  // have already signed. It throws so the caller can say "try again" instead.
  const { data, error } = await selectInBatches<{ document_id: string }>(documentIds, (batch) =>
    client
      .from("data_room_document_signatures")
      .select("document_id")
      .eq("share_id", shareId)
      .ilike("signer_email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .in("document_id", batch) as unknown as PromiseLike<{ data: { document_id: string }[] | null; error: { message: string } | null }>,
  );
  if (error) throw new DataRoomReadError("signatures", error);
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
    signaturePng: string;
    agreed: boolean;
    email: string | null;
    ipHint: string | null;
    now?: Date;
  },
): Promise<SignDocumentResult> {
  const name = input.signerName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Type your full name to sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };
  if (!parseSignaturePng(input.signaturePng)) return { ok: false, error: "Draw or type your signature to sign." };
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
      signature_png: input.signaturePng,
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
  signature_png: string | null;
  ip_hint: string | null;
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
      "id, organization_id, room_id, document_id, share_id, signer_name, signer_email, signed_at, file_name, file_sha256, signature_png, ip_hint, copy_sent_at",
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
<p><a href="${signedCopyUrl(sig.id)}">Download your signed copy (PDF)</a></p>
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

// ─── The fund's counter-signature ────────────────────────────────────────────

export type CountersignDocumentResult = { ok: true; signatureId: string } | { ok: false; error: string };

/**
 * The fund counter-signs a reader's signature. The caller has already checked the
 * member may (owner or admin, confirmed email); this records it. The update only
 * lands while the signature is still awaiting one, so two members signing at once
 * cannot overwrite each other: the second is told it is already done.
 */
export async function countersignDocument(
  client: Client,
  input: {
    orgId: string;
    signatureId: string;
    signerName: string;
    signaturePng: string;
    signerEmail: string;
    userId: string;
    agreed: boolean;
    now?: Date;
  },
): Promise<CountersignDocumentResult> {
  const name = input.signerName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Type your full name to counter-sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };
  if (!parseSignaturePng(input.signaturePng)) return { ok: false, error: "Draw or type your signature to counter-sign." };
  if (!input.agreed) return { ok: false, error: "Tick the box to confirm." };

  const now = input.now ?? new Date();
  const { data, error } = await client
    .from("data_room_document_signatures")
    .update({
      countersigner_name: name,
      countersigner_email: normalizeEmail(input.signerEmail),
      countersigner_user_id: input.userId,
      countersigned_at: now.toISOString(),
      countersignature_png: input.signaturePng,
    })
    .eq("id", input.signatureId)
    .eq("organization_id", input.orgId)
    .is("countersigned_at", null)
    .select("id")
    .maybeSingle();
  const id = (data as { id: string } | null)?.id;
  if (id) return { ok: true, signatureId: id };
  if (error) return { ok: false, error: "We couldn't record your counter-signature. Please try again." };

  // Nothing was updated and nothing failed: it was already counter-signed, or it is not ours.
  const { data: existing } = await client
    .from("data_room_document_signatures")
    .select("countersigned_at")
    .eq("id", input.signatureId)
    .eq("organization_id", input.orgId)
    .maybeSingle();
  const row = existing as { countersigned_at: string | null } | null;
  if (row?.countersigned_at) return { ok: false, error: "This has already been counter-signed." };
  return { ok: false, error: "We couldn't find that signature." };
}

/**
 * After a counter-signature, best effort (it stands whether or not this succeeds):
 * the executed copy's link to the person who signed and to the member who
 * counter-signed.
 */
export async function afterDocumentCountersigned(client: Client, signatureId: string): Promise<void> {
  const { data } = await client
    .from("data_room_document_signatures")
    .select(
      "id, organization_id, room_id, signer_name, signer_email, file_name, countersigner_name, countersigner_email, countersigned_at, countersign_copy_sent_at",
    )
    .eq("id", signatureId)
    .maybeSingle();
  const sig = data as {
    id: string;
    organization_id: string;
    room_id: string;
    signer_name: string;
    signer_email: string;
    file_name: string;
    countersigner_name: string | null;
    countersigner_email: string | null;
    countersigned_at: string | null;
    countersign_copy_sent_at: string | null;
  } | null;
  if (!sig?.countersigned_at || sig.countersign_copy_sent_at) return;

  const [{ data: orgData }, { data: roomData }] = await Promise.all([
    client.from("organizations").select("name").eq("id", sig.organization_id).maybeSingle(),
    client.from("data_rooms").select("name").eq("id", sig.room_id).maybeSingle(),
  ]);
  const orgName = (orgData as { name: string } | null)?.name ?? "the fund";
  const roomName = (roomData as { name: string } | null)?.name ?? "the data room";
  const when = formatSignedAt(sig.countersigned_at);
  const link = signedCopyUrl(sig.id);
  const body = (greeting: string) => `<p>${greeting}</p>
<p><strong>${escapeHtml(sig.file_name)}</strong> in <strong>${escapeHtml(roomName)}</strong> was signed by ${escapeHtml(sig.signer_name)} and counter-signed by ${escapeHtml(sig.countersigner_name ?? "the fund")} (${escapeHtml(orgName)}) on ${escapeHtml(when)}.</p>
<p><a href="${link}">Download the executed copy (PDF)</a></p>`;

  const toSigner = await sendEmail({
    orgId: sig.organization_id,
    to: { name: sig.signer_name, email: sig.signer_email },
    subject: `Executed: ${sig.file_name} — ${orgName}`,
    htmlBody: body(`Hi ${escapeHtml(sig.signer_name)},`),
    allowFallback: true,
  }).catch(() => ({ ok: false }));
  if (sig.countersigner_email) {
    await sendEmail({
      orgId: sig.organization_id,
      to: { name: sig.countersigner_name ?? "", email: sig.countersigner_email },
      subject: `You counter-signed ${sig.file_name}`,
      htmlBody: body(`Hi ${escapeHtml(sig.countersigner_name ?? "")},`),
      allowFallback: true,
    }).catch(() => undefined);
  }
  if (toSigner.ok) {
    await client
      .from("data_room_document_signatures")
      .update({ countersign_copy_sent_at: new Date().toISOString() })
      .eq("id", sig.id)
      .then(() => undefined, () => undefined);
  }
}

// ─── The signed copy ─────────────────────────────────────────────────────────

function copySecret(): string {
  return createHmac("sha256", "fx-doc-signature-copy").update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").digest("hex");
}
export function signedCopyToken(signatureId: string): string {
  return createHmac("sha256", copySecret()).update(signatureId).digest("base64url");
}
export function signedCopyTokenValid(signatureId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(signedCopyToken(signatureId));
  return a.length === b.length && timingSafeEqual(a, b);
}
export function signedCopyUrl(signatureId: string): string {
  return `${SITE_URL}/api/dataroom/doc-signature/${signatureId}?t=${signedCopyToken(signatureId)}`;
}

/**
 * The file the signer signed with their signature page appended (their own PDF
 * stays as it was; any other kind of file gets a record page naming it), sealed
 * when the deploy has a certificate.
 */
export async function buildSignedCopy(
  client: Client,
  signatureId: string,
  orgId?: string,
): Promise<{ pdf: Uint8Array; signerName: string; sealed: boolean } | null> {
  let q = client
    .from("data_room_document_signatures")
    .select(
      "id, organization_id, document_id, signer_name, signer_email, signed_at, ip_hint, file_name, file_sha256, signature_png, countersigner_name, countersigner_email, countersigned_at, countersignature_png",
    )
    .eq("id", signatureId);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.maybeSingle();
  const sig = data as {
    id: string; organization_id: string; document_id: string; signer_name: string; signer_email: string;
    signed_at: string; ip_hint: string | null; file_name: string; file_sha256: string; signature_png: string | null;
    countersigner_name: string | null; countersigner_email: string | null; countersigned_at: string | null; countersignature_png: string | null;
  } | null;
  if (!sig) return null;

  const { data: docRow } = await client
    .from("documents")
    .select("storage_key, content, name")
    .eq("id", sig.document_id)
    .maybeSingle();
  const doc = docRow as Pick<Document, "storage_key" | "content" | "name"> | null;

  const counterStamps =
    sig.countersigned_at && sig.countersigner_name
      ? [{ label: "Countersigner (fund)", name: sig.countersigner_name, email: sig.countersigner_email ?? "", signedAt: sig.countersigned_at, ipHint: null, signaturePng: sig.countersignature_png }]
      : [];
  const executed = counterStamps.length > 0;

  let basePdf: Uint8Array | undefined;
  if (doc?.storage_key && isUploadedFile(doc.storage_key) && /\.pdf$/i.test(doc.storage_key)) {
    const { data: blob } = await client.storage.from(DOCUMENT_BUCKET).download(doc.storage_key);
    if (blob && blob.size <= MAX_HASH_BYTES) basePdf = new Uint8Array(await blob.arrayBuffer());
  }
  let built: Uint8Array;
  try {
    built = await buildSignedPdf({
      title: `${sig.file_name} - ${executed ? "executed" : `signed by ${sig.signer_name}`}`,
      ...(basePdf ? { basePdf } : { text: doc?.content?.trim() ? doc.content : `Signed document: ${sig.file_name}` }),
      stamps: [
        { label: "Signer", name: sig.signer_name, email: sig.signer_email, signedAt: sig.signed_at, ipHint: sig.ip_hint, signaturePng: sig.signature_png },
        ...counterStamps,
      ],
      fingerprint: sig.file_sha256,
      recordId: sig.id,
    });
  } catch {
    // An unreadable or encrypted PDF: fall back to the record page alone.
    built = await buildSignedPdf({
      title: sig.file_name,
      text: `Signed document: ${sig.file_name}`,
      stamps: [
        { label: "Signer", name: sig.signer_name, email: sig.signer_email, signedAt: sig.signed_at, ipHint: sig.ip_hint, signaturePng: sig.signature_png },
        ...counterStamps,
      ],
      fingerprint: sig.file_sha256,
      recordId: sig.id,
    });
  }
  const sealed = await sealPdf(built, { reason: `${executed ? "Executed" : "Signed"} ${sig.file_name}`, name: "FundExecs OS" });
  return { pdf: sealed.pdf, signerName: sig.signer_name, sealed: sealed.sealed };
}
