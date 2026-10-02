"use server";

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Signs the link's NDA for this reader and emails them their copy.
 *
 * The browser sends only the typed name and the "I agree" tick. The signing
 * time is the server's, the email is the one this reader gave the link's
 * email gate (read from the signed pass, never from the form), and the text
 * recorded is the link's NDA as it stands now. On success the "nda" gate is
 * granted via the signed server-side pass.
 */
export async function recordNdaSignature(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const shareId = String(formData.get("share_id") ?? "").trim();
  const signerName = String(formData.get("signer_name") ?? "");
  const agreed = formData.get("agree") === "1";
  if (!shareId) return { ok: false, error: "We couldn't record your signature. Please try again." };

  // A partial address for the audit trail: the first 3 octets (IPv4) or
  // groups (IPv6). The full IP is never stored.
  let ipHint: string | null = null;
  try {
    const headersList = await headers();
    const rawIp = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headersList.get("x-real-ip") ?? null;
    if (rawIp) {
      const parts = rawIp.split(".");
      ipHint = parts.length === 4 ? parts.slice(0, 3).join(".") : rawIp.split(":").slice(0, 3).join(":");
    }
  } catch {
    // headers() unavailable in some edge environments; skip
  }

  const { readGatePass, grantGate } = await import("@/lib/data-room-gate");
  const pass = await readGatePass(shareId);
  const supabase = createServiceClient();
  const { signNda, sendNdaCopy } = await import("@/lib/nda-signing.server");
  const result = await signNda(supabase, { shareId, signerName, agreed, gateEmail: pass?.email ?? null, ipHint });
  if (!result.ok) return result;

  await grantGate(shareId, { nda: true });
  // After the response, so the reader is not kept waiting on the mail send.
  const { after } = await import("next/server");
  after(() => sendNdaCopy(supabase, result.signatureId, result.orgId).then(() => undefined, () => undefined));
  return { ok: true };
}

/**
 * Records that a visitor provided their email for a data room that requires
 * one (data capture, not authentication — there's no secret to check), then
 * grants the "email" gate for this share via a signed server-side pass.
 */
export async function passEmailGate(
  token: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const generic = { ok: false as const, error: "Something went wrong. Please try again." };
  const trimmed = email.trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const supabase = createServiceClient();
  const { data: share } = await supabase
    .from("data_room_shares")
    .select("id, organization_id, revoked_at, expires_at, allowed_email_domains, max_readers")
    .eq("token", token)
    .maybeSingle();
  if (!share) return generic;
  const shareRow = share as {
    id: string;
    organization_id: string;
    revoked_at: string | null;
    expires_at: string | null;
    allowed_email_domains: string[] | null;
    max_readers: number | null;
  };
  if (shareRow.revoked_at) return generic;
  if (shareRow.expires_at && new Date(shareRow.expires_at).getTime() < Date.now()) return generic;

  const { emailDomainAllowed, describeDomains } = await import("@/lib/data-room-link-rules");
  if (!emailDomainAllowed(trimmed, shareRow.allowed_email_domains)) {
    return {
      ok: false,
      error: `This link is for ${describeDomains(shareRow.allowed_email_domains ?? [])} addresses. Ask the sender for access with another address.`,
    };
  }

  // The reader cap counts distinct emails. Someone already admitted always
  // gets back in; only a new reader is refused once the link is full.
  if (shareRow.max_readers) {
    const key = trimmed.toLowerCase();
    const { data: known } = await supabase
      .from("data_room_link_readers")
      .select("email")
      .eq("share_id", shareRow.id)
      .eq("email", key)
      .maybeSingle();
    if (!known) {
      const { count } = await supabase
        .from("data_room_link_readers")
        .select("email", { count: "exact", head: true })
        .eq("share_id", shareRow.id);
      if ((count ?? 0) >= shareRow.max_readers) {
        return { ok: false, error: "This link has reached its reader limit. Ask the sender for a new link." };
      }
    }
  }
  // Recorded for every email-gated link, capped or not, so a cap added later
  // counts the readers who already came in.
  await supabase
    .from("data_room_link_readers")
    .upsert(
      { share_id: shareRow.id, email: trimmed.toLowerCase(), organization_id: shareRow.organization_id } as never,
      { onConflict: "share_id,email", ignoreDuplicates: true },
    )
    .then(() => undefined, () => undefined);

  const { grantGate } = await import("@/lib/data-room-gate");
  await grantGate(shareRow.id, { email: trimmed });

  return { ok: true };
}

/**
 * The reader is now looking at the room's content. Records their first open
 * of this link and, the first time only, emails the link's creator when they
 * asked to be told. Called once per page view from the viewer.
 *
 * Re-checks everything the page did — the link is live and every gate this
 * reader must pass is passed — because a Server Action is a public endpoint
 * and the page's word for it is not enough.
 */
export async function recordRoomOpen(token: string, visitorId: string): Promise<void> {
  if (typeof token !== "string" || !token || typeof visitorId !== "string") return;
  const { hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("data_room_shares")
    .select(
      "id, organization_id, room_id, label, notify_on_open, created_by, revoked_at, expires_at, require_email, require_nda, password_hash, allowed_email_domains",
    )
    .eq("token", token)
    .maybeSingle();
  const share = data as {
    id: string;
    organization_id: string;
    room_id: string | null;
    label: string | null;
    notify_on_open: boolean;
    created_by: string | null;
    revoked_at: string | null;
    expires_at: string | null;
    require_email: boolean;
    require_nda: boolean;
    password_hash: string | null;
    allowed_email_domains: string[] | null;
  } | null;
  if (!share || share.revoked_at || !share.room_id) return;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return;

  const { readGatePass, gateSatisfied } = await import("@/lib/data-room-gate");
  const pass = await readGatePass(share.id);
  if (!gateSatisfied(share, pass)) return;

  const { viewerKeyFor } = await import("@/lib/data-room-alerts");
  const viewerEmail = pass?.email ?? null;
  const key = viewerKeyFor(viewerEmail, visitorId);
  if (!key) return;
  const { recordFirstOpen } = await import("@/lib/data-room-alerts.server");
  await recordFirstOpen(supabase, share, key, viewerEmail).catch(() => undefined);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The viewer drains its clock every 30s; anything far beyond that is not reading. */
const MAX_SECONDS_PER_ENTRY = 600;
const MAX_ENTRIES = 50;

/**
 * Record reading time per document from the public viewer. Same checks as
 * recordRoomOpen: the link is live and the reader passed every gate. The
 * reader's email comes from their gate pass, never from the browser, and a
 * document id counts only if it is published in this link's room.
 */
export async function trackReading(
  token: string,
  visitorId: string,
  entries: { documentId: string | null; seconds: number }[],
): Promise<void> {
  if (typeof token !== "string" || !token || !Array.isArray(entries) || entries.length === 0) return;
  const { hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("data_room_shares")
    .select("id, organization_id, room_id, revoked_at, expires_at, require_email, require_nda, password_hash, allowed_email_domains")
    .eq("token", token)
    .maybeSingle();
  const share = data as {
    id: string;
    organization_id: string;
    room_id: string | null;
    revoked_at: string | null;
    expires_at: string | null;
    require_email: boolean;
    require_nda: boolean;
    password_hash: string | null;
    allowed_email_domains: string[] | null;
  } | null;
  if (!share || share.revoked_at || !share.room_id) return;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return;

  const { readGatePass, gateSatisfied } = await import("@/lib/data-room-gate");
  const pass = await readGatePass(share.id);
  if (!gateSatisfied(share, pass)) return;

  const clean = entries
    .slice(0, MAX_ENTRIES)
    .filter(
      (e) =>
        e &&
        Number.isInteger(e.seconds) &&
        e.seconds > 0 &&
        (e.documentId === null || (typeof e.documentId === "string" && UUID.test(e.documentId))),
    )
    .map((e) => ({ documentId: e.documentId, seconds: Math.min(e.seconds, MAX_SECONDS_PER_ENTRY) }));
  const ids = [...new Set(clean.map((e) => e.documentId).filter((d): d is string => d !== null))];
  let published = new Set<string>();
  if (ids.length) {
    const { data: rows } = await supabase
      .from("data_room_documents")
      .select("document_id")
      .eq("room_id", share.room_id)
      .in("document_id", ids);
    published = new Set(((rows ?? []) as { document_id: string }[]).map((r) => r.document_id));
  }
  const rows = clean
    .filter((e) => e.documentId === null || published.has(e.documentId))
    .map((e) => ({
      organization_id: share.organization_id,
      share_id: share.id,
      room_id: share.room_id,
      document_id: e.documentId,
      kind: e.documentId ? "document" : "room",
      action: "read",
      viewer_email: pass?.email ?? null,
      duration_seconds: e.seconds,
      session_id: /^[A-Za-z0-9-]{8,64}$/.test(visitorId ?? "") ? visitorId : null,
    }));
  if (rows.length === 0) return;
  await supabase
    .from("data_room_views")
    .insert(rows as never)
    .then(() => undefined, () => undefined);
}
