// lib/nda-signing.server.ts
//
// Signing a data-room NDA, as a record that holds up later. The server decides
// everything the record says: when it was signed (its own clock), who signed it
// (the email this reader gave the link's email gate), and what was signed (the
// link's NDA text as it stands now, kept on the row with its fingerprint).
// The browser contributes only the typed name and the "I agree" tick.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { ndaTextFor } from "@/lib/nda";
import { ndaCopyEmail, ndaCopyUrl, ndaFingerprint, type NdaRecord } from "@/lib/nda.server";

// Public endpoint, so the client is untyped here: the tables are read through
// narrow casts below rather than the generated types.
type Client = SupabaseClient;

export type SignResult = { ok: true; signatureId: string; orgId: string } | { ok: false; error: string };

const GENERIC = "We couldn't record your signature. Please try again.";

export async function signNda(
  client: Client,
  input: { shareId: string; signerName: string; agreed: boolean; gateEmail: string | null; ipHint: string | null; now?: Date },
): Promise<SignResult> {
  const name = input.signerName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Type your full name to sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };
  if (!input.agreed) return { ok: false, error: "Tick the box to confirm you agree." };

  const { data } = await client
    .from("data_room_shares")
    .select("id, organization_id, revoked_at, expires_at, require_nda, nda_text")
    .eq("id", input.shareId)
    .maybeSingle();
  const share = data as {
    id: string;
    organization_id: string;
    revoked_at: string | null;
    expires_at: string | null;
    require_nda: boolean;
    nda_text: string | null;
  } | null;
  const now = input.now ?? new Date();
  if (!share || !share.require_nda || share.revoked_at) return { ok: false, error: GENERIC };
  if (share.expires_at && new Date(share.expires_at).getTime() < now.getTime()) return { ok: false, error: GENERIC };
  // An NDA link always has an email gate in front of it (the database holds
  // the same rule), so a signature without a gate email is someone skipping it.
  if (!input.gateEmail) return { ok: false, error: "Enter your email first, then sign." };

  const text = ndaTextFor(share.nda_text);
  const { data: row, error } = await client
    .from("nda_signatures")
    .insert({
      share_id: share.id,
      organization_id: share.organization_id,
      signer_name: name,
      signer_email: input.gateEmail,
      signed_at: now.toISOString(),
      ip_hint: input.ipHint,
      nda_text: text,
      nda_sha256: ndaFingerprint(text),
      agreed: true,
    })
    .select("id")
    .maybeSingle();
  const id = (row as { id: string } | null)?.id;
  if (error || !id) return { ok: false, error: GENERIC };
  return { ok: true, signatureId: id, orgId: share.organization_id };
}

/** Everything the signed copy shows, read fresh from the database. */
export async function loadNdaRecord(client: Client, signatureId: string, orgId?: string): Promise<NdaRecord | null> {
  let q = client
    .from("nda_signatures")
    .select("id, share_id, organization_id, signer_name, signer_email, signed_at, ip_hint, nda_text, nda_sha256, agreed")
    .eq("id", signatureId);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.maybeSingle();
  const sig = data as {
    id: string;
    share_id: string;
    organization_id: string;
    signer_name: string;
    signer_email: string | null;
    signed_at: string;
    ip_hint: string | null;
    nda_text: string | null;
    nda_sha256: string | null;
    agreed: boolean | null;
  } | null;
  if (!sig) return null;
  const [{ data: shareData }, { data: orgData }] = await Promise.all([
    client.from("data_room_shares").select("label, room_id").eq("id", sig.share_id).maybeSingle(),
    client.from("organizations").select("name").eq("id", sig.organization_id).maybeSingle(),
  ]);
  const share = shareData as { label: string | null; room_id: string | null } | null;
  let roomName: string | null = null;
  if (share?.room_id) {
    const { data: roomData } = await client.from("data_rooms").select("name").eq("id", share.room_id).maybeSingle();
    roomName = (roomData as { name: string } | null)?.name ?? null;
  }
  return {
    id: sig.id,
    signerName: sig.signer_name,
    signerEmail: sig.signer_email,
    signedAt: sig.signed_at,
    ipHint: sig.ip_hint,
    text: sig.nda_text,
    sha256: sig.nda_sha256,
    agreed: Boolean(sig.agreed),
    orgName: (orgData as { name: string } | null)?.name ?? "the fund",
    roomName,
    linkLabel: share?.label ?? null,
  };
}

/**
 * Email the signer their copy, from the fund's own mailbox (or the deploy's
 * backup sender). Best effort: the signature stands whether or not this sends.
 */
export async function sendNdaCopy(client: Client, signatureId: string, orgId: string): Promise<boolean> {
  const r = await loadNdaRecord(client, signatureId, orgId);
  if (!r?.signerEmail || !r.sha256) return false;
  const { subject, html } = ndaCopyEmail({
    orgName: r.orgName,
    roomName: r.roomName,
    signerName: r.signerName,
    signedAt: r.signedAt,
    sha256: r.sha256,
    downloadUrl: ndaCopyUrl(r.id),
  });
  const sent = await sendEmail({
    orgId,
    to: { name: r.signerName, email: r.signerEmail },
    subject,
    htmlBody: html,
    allowFallback: true,
  }).catch(() => ({ ok: false }));
  if (!sent.ok) return false;
  await client
    .from("nda_signatures")
    .update({ copy_sent_at: new Date().toISOString() })
    .eq("id", r.id)
    .then(() => undefined, () => undefined);
  return true;
}
