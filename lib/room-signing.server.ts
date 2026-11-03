// lib/room-signing.server.ts
//
// Signing a data-room file through the shared envelope flow. The owner places
// signature blocks on a file once (a template kept on the room's publish row); each
// reader who opens the file gets their own envelope, copied from the file with those
// blocks. The reader signs on the page; the owner is told and countersigns.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_BUCKET, isUploadedFile } from "@/lib/document-files";
import { createEnvelope } from "@/lib/envelope-create.server";
import { buildDocumentPdf } from "@/lib/signing/executed-pdf.server";
import type { CleanBlock } from "@/lib/envelope-fields";
import type { Document } from "@/lib/supabase/database.types";

type Client = SupabaseClient;

/** The parties a template names; real recipients replace them when a reader's copy is made. */
export const TEMPLATE_PARTIES = ["signer", "owner"] as const;

export type TemplateBlock = CleanBlock;

const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** The blocks the owner placed on this file in this room, or null if none. */
export async function loadTemplate(client: Client, roomId: string, documentId: string): Promise<TemplateBlock[] | null> {
  const { data } = await client
    .from("data_room_documents")
    .select("signature_blocks")
    .eq("room_id", roomId)
    .eq("document_id", documentId)
    .maybeSingle();
  const raw = (data as { signature_blocks: unknown } | null)?.signature_blocks;
  return Array.isArray(raw) && raw.length > 0 ? (raw as TemplateBlock[]) : null;
}

/**
 * The file as a PDF to sign: an uploaded PDF as it is, a written document turned into
 * a PDF. Anything else (a Word file, a link) cannot be signed on its pages.
 */
export async function documentPdf(
  client: Client,
  doc: Pick<Document, "storage_key" | "content" | "name">,
): Promise<Uint8Array | null> {
  if (doc.storage_key && isUploadedFile(doc.storage_key)) {
    if (!/\.pdf$/i.test(doc.storage_key)) return null;
    const { data: blob, error } = await client.storage.from(DOCUMENT_BUCKET).download(doc.storage_key);
    if (error || !blob || blob.size > MAX_PDF_BYTES) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (!doc.storage_key && doc.content?.trim()) return buildDocumentPdf({ title: doc.name, text: doc.content });
  return null;
}

/** Whether a file can carry signature blocks at all. */
export function canCarrySignature(doc: Pick<Document, "storage_key" | "content">): boolean {
  if (doc.storage_key) return isUploadedFile(doc.storage_key) && /\.pdf$/i.test(doc.storage_key);
  return Boolean(doc.content?.trim());
}

/**
 * The template's blocks as rows for one reader's envelope: "signer" becomes the
 * reader, "owner" the countersigner. A name or email block the owner left empty
 * starts with the reader's own, which they can still change.
 */
export function instantiateBlocks(
  template: TemplateBlock[],
  ids: { signer: string; owner: string },
  readerName: string,
  envelopeId: string,
  readerEmail: string | null = null,
) {
  return template.map((b) => ({
    envelope_id: envelopeId,
    recipient_id: b.recipient_id === "owner" ? ids.owner : ids.signer,
    field_type: b.field_type,
    page: b.page,
    x_pct: b.x_pct,
    y_pct: b.y_pct,
    width_pct: b.width_pct,
    height_pct: b.height_pct,
    label: b.label,
    required: b.required,
    prefill:
      b.prefill ??
      (b.recipient_id === "owner" ? null : b.field_type === "name" ? readerName : b.field_type === "email" ? readerEmail : null),
    locked: b.locked,
  }));
}

/** Who countersigns: the link's creator if they are an owner or admin, else an owner. */
export async function resolveCountersigner(
  client: Client,
  orgId: string,
  createdBy: string | null,
): Promise<{ id: string; email: string | null; name: string | null } | null> {
  const { data: members } = await client
    .from("organization_members")
    .select("principal_id, role, created_at")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin"])
    .order("created_at", { ascending: true });
  const rows = (members ?? []) as { principal_id: string; role: string }[];
  const pick = rows.find((m) => m.principal_id === createdBy) ?? rows.find((m) => m.role === "owner") ?? rows[0];
  if (!pick) return null;
  const { data } = await client.auth.admin.getUserById(pick.principal_id).catch(() => ({ data: null }));
  const u = (data as { user?: { email?: string; user_metadata?: { full_name?: string } } } | null)?.user;
  return { id: pick.principal_id, email: u?.email ?? null, name: u?.user_metadata?.full_name ?? null };
}

export interface ReaderSigningBlock {
  id: string;
  type: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  prefill: string | null;
  locked: boolean;
}

export type ReaderSigningView =
  | { ok: true; state: "ready"; title: string; signingToken: string; blocks: ReaderSigningBlock[] }
  /** The reader has already signed this file. */
  | { ok: true; state: "signed" }
  | { ok: false; error: string };

/** The reader's envelope as the viewer needs it: their link and their blocks, or "signed". */
export async function readerSigningView(client: Client, envelopeId: string): Promise<ReaderSigningView> {
  const { data: env } = await client.from("envelopes").select("id, title, status").eq("id", envelopeId).maybeSingle();
  const e = env as { id: string; title: string; status: string } | null;
  if (!e || e.status === "voided") return { ok: false, error: "This signature request is no longer available." };
  const { data: rec } = await client
    .from("envelope_recipients")
    .select("id, status, signing_token")
    .eq("envelope_id", envelopeId)
    .eq("role", "signer")
    .maybeSingle();
  const r = rec as { id: string; status: string; signing_token: string } | null;
  if (!r) return { ok: false, error: "This signature request is no longer available." };
  if (r.status === "signed") return { ok: true, state: "signed" };
  const { data: flds } = await client
    .from("envelope_fields")
    .select("id, field_type, page, x_pct, y_pct, width_pct, height_pct, required, prefill, locked")
    .eq("recipient_id", r.id);
  const blocks = ((flds ?? []) as {
    id: string; field_type: string; page: number; x_pct: number; y_pct: number;
    width_pct: number; height_pct: number; required: boolean; prefill: string | null; locked: boolean;
  }[]).map((f) => ({
    id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct,
    widthPct: f.width_pct, heightPct: f.height_pct, required: f.required, prefill: f.prefill, locked: f.locked,
  }));
  return { ok: true, state: "ready", title: e.title, signingToken: r.signing_token, blocks };
}

/**
 * Open a reader's signature request for a file: their own copy of it with the owner's
 * blocks, already sent, so they can sign it straight away. If they have one already
 * (they reloaded the page) it is returned rather than made again.
 */
export async function startReaderSigning(
  client: Client,
  input: {
    share: { id: string; organization_id: string; created_by: string | null };
    roomId: string;
    doc: Pick<Document, "id" | "name" | "storage_key" | "content">;
    readerName: string;
    readerEmail: string;
  },
): Promise<ReaderSigningView> {
  const email = input.readerEmail.trim().toLowerCase();
  const escaped = email.replace(/[\\%_]/g, (c) => `\\${c}`);

  const { data: existing } = await client
    .from("envelopes")
    .select("id")
    .eq("data_room_share_id", input.share.id)
    .eq("data_room_document_id", input.doc.id)
    .ilike("reader_email", escaped)
    .neq("status", "voided")
    .maybeSingle();
  if (existing) return readerSigningView(client, (existing as { id: string }).id);

  const template = await loadTemplate(client, input.roomId, input.doc.id);
  if (!template) return { ok: false, error: "The sender has not finished setting up this document for signing yet." };
  const pdf = await documentPdf(client, input.doc);
  if (!pdf) return { ok: false, error: "This document cannot be signed here." };
  const owner = await resolveCountersigner(client, input.share.organization_id, input.share.created_by);
  if (!owner) return { ok: false, error: "The sender has not finished setting up this document for signing yet." };

  const name = input.readerName.trim().replace(/\s+/g, " ");
  const created = await createEnvelope(client, {
    orgId: input.share.organization_id,
    creator: owner,
    title: `${input.doc.name} - ${name}`,
    message: null,
    documentContent: input.doc.name,
    pdfBytes: pdf,
    recipients: [{ name, email }],
    extra: { data_room_share_id: input.share.id, data_room_document_id: input.doc.id, reader_email: email },
  });
  if (!created.ok) {
    // Another tab got there first (the unique index): use theirs.
    if (created.status === 500) {
      const { data: again } = await client
        .from("envelopes")
        .select("id")
        .eq("data_room_share_id", input.share.id)
        .eq("data_room_document_id", input.doc.id)
        .ilike("reader_email", escaped)
        .neq("status", "voided")
        .maybeSingle();
      if (again) return readerSigningView(client, (again as { id: string }).id);
    }
    return { ok: false, error: created.error };
  }

  const readerRecipientId = created.recipients[0]?.id;
  const { error: fieldsErr } = await client
    .from("envelope_fields")
    .insert(instantiateBlocks(template, { signer: readerRecipientId, owner: created.ownerRecipientId }, name, created.envelopeId, email));
  if (fieldsErr) {
    await client.from("envelopes").update({ status: "voided", void_reason: "Could not place signature blocks" }).eq("id", created.envelopeId);
    return { ok: false, error: "We couldn't prepare this document for signing. Please try again." };
  }

  await client.from("envelopes").update({ status: "sent" }).eq("id", created.envelopeId);
  await client.from("envelope_events").insert({ envelope_id: created.envelopeId, event_type: "sent", metadata: { source: "data_room" } });
  return readerSigningView(client, created.envelopeId);
}
