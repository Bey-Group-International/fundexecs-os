// lib/document-signing.server.ts
//
// Who has signed a file in a data room, and the older signature records.
//
// New signatures on a data-room file go through the shared envelope flow
// (lib/room-signing.server.ts). This module answers "has this reader signed?" across
// both that flow and the older drawn-signature table, whose rows still unlock their
// files and can still be countersigned and downloaded.
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
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

/** Largest file we will read into memory to stamp. */
const MAX_HASH_BYTES = 100 * 1024 * 1024;


/**
 * Which of these documents this reader (by email) has signed on this link: through the
 * envelope flow (their own signature is on it, whether or not the fund has countersigned
 * yet) or through the older signature table.
 */
export async function signedDocumentIds(
  client: Client,
  shareId: string,
  email: string | null,
  documentIds: string[],
): Promise<Set<string>> {
  if (!email || documentIds.length === 0) return new Set();
  const like = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  // Batched for the same reason as the room's document read: a long `.in()`
  // overflows the URL and the read errors. An errored read is not "nothing
  // signed": it would show a reader the signature form again for a file they
  // have already signed. It throws so the caller can say "try again" instead.
  const legacy = await selectInBatches<{ document_id: string }>(documentIds, (batch) =>
    client
      .from("data_room_document_signatures")
      .select("document_id")
      .eq("share_id", shareId)
      .ilike("signer_email", like)
      .in("document_id", batch) as unknown as PromiseLike<{ data: { document_id: string }[] | null; error: { message: string } | null }>,
  );
  if (legacy.error) throw new DataRoomReadError("signatures", legacy.error);

  const envelopes = await selectInBatches<{ id: string; data_room_document_id: string }>(documentIds, (batch) =>
    client
      .from("envelopes")
      .select("id, data_room_document_id")
      .eq("data_room_share_id", shareId)
      .ilike("reader_email", like)
      .neq("status", "voided")
      .in("data_room_document_id", batch) as unknown as PromiseLike<{ data: { id: string; data_room_document_id: string }[] | null; error: { message: string } | null }>,
  );
  if (envelopes.error) throw new DataRoomReadError("signatures", envelopes.error);

  const signed = new Set((legacy.data ?? []).map((r) => r.document_id));
  const envs = envelopes.data ?? [];
  if (envs.length) {
    const byEnvelope = new Map(envs.map((e) => [e.id, e.data_room_document_id]));
    const rec = await selectInBatches<{ envelope_id: string }>([...byEnvelope.keys()], (batch) =>
      client
        .from("envelope_recipients")
        .select("envelope_id")
        .eq("role", "signer")
        .eq("status", "signed")
        .in("envelope_id", batch) as unknown as PromiseLike<{ data: { envelope_id: string }[] | null; error: { message: string } | null }>,
    );
    if (rec.error) throw new DataRoomReadError("signatures", rec.error);
    for (const r of rec.data ?? []) {
      const docId = byEnvelope.get(r.envelope_id);
      if (docId) signed.add(docId);
    }
  }
  return signed;
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
