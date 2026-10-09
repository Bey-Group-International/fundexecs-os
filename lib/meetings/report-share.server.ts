// lib/meetings/report-share.server.ts
// A private, expiring link to a meeting's report, for somebody with no account.
//
// Two kinds of person hold one. The summary email ended with "View the full
// report", a link into the app that opens only for a signed-in member of the
// organization who was in the meeting. Every external invitee — the people the
// email is mostly for — met a login wall. Each copy of the email now carries
// its own signed link instead: it names the meeting and the recipient, expires,
// and opens a read-only summary (no transcript, chat or recording) without an
// account.
//
// The second is the invite-link GUEST, who sat through the meeting and has
// even less: no account, no address on file, and a participant row the
// report's RLS cannot match (it keys on `user_id`, and a guest has none). The
// thank-you screen mints them the same kind of link, for the key their
// browser holds — see app/api/meetings/public/[roomCode]/report-link. The
// token carries a HASH of that key rather than the key: the key is also what
// admits them to the room, and a link is forwarded far more casually than a
// browser's storage is.
//
// Signed with a key derived from the service-role key, as the data-room gate
// does, so nothing new needs provisioning: the page reads with the service
// role, so it cannot work anywhere that key is missing anyway.

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { SITE_URL } from "@/lib/site";

/** How long a shared report link keeps working. */
export const REPORT_SHARE_TTL_MS = 30 * 86_400_000;

export interface ReportSharePayload {
  /** The meeting's room code. */
  r: string;
  /** Expiry, epoch ms. */
  x: number;
  /** The recipient's address, lowercased — an emailed link. */
  e?: string;
  /** A digest of the guest key — a link minted for a guest who was in the room. */
  g?: string;
}

function shareSecret(): string | null {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base) return null;
  return createHmac("sha256", "fx-meeting-report-share").update(base).digest("hex");
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * The guest key as the token carries it: a digest, never the key.
 *
 * Exported so the public route and a test agree on it; nothing reverses it.
 */
export function guestSubject(guestKey: string): string {
  return createHash("sha256").update(guestKey).digest("base64url").slice(0, 32);
}

function sign(payload: ReportSharePayload): string | null {
  const secret = shareSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** A token for this meeting and emailed recipient, or null when links cannot be signed here. */
export function signReportShare(roomCode: string, email: string, now = Date.now()): string | null {
  const e = normalizeEmail(email);
  if (!roomCode || !e) return null;
  return sign({ r: roomCode, e, x: now + REPORT_SHARE_TTL_MS });
}

/** A token for this meeting and an admitted guest's key, or null when links cannot be signed here. */
export function signGuestReportShare(roomCode: string, guestKey: string, now = Date.now()): string | null {
  const key = (guestKey ?? "").trim();
  if (!roomCode || !key) return null;
  return sign({ r: roomCode, g: guestSubject(key), x: now + REPORT_SHARE_TTL_MS });
}

/**
 * The payload of a genuine, unexpired token; null for anything else.
 *
 * Exactly one subject, always: a token naming nobody would be a link to a
 * meeting's summary for whoever holds it, and one naming both is not a shape
 * anything here signs.
 */
export function verifyReportShare(token: string, now = Date.now()): ReportSharePayload | null {
  const secret = shareSecret();
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(secret, body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ReportSharePayload>;
    if (typeof p.r !== "string" || typeof p.x !== "number") return null;
    if (p.x <= now) return null;
    const hasEmail = typeof p.e === "string" && p.e.length > 0;
    const hasGuest = typeof p.g === "string" && p.g.length > 0;
    if (hasEmail === hasGuest) return null;
    return hasEmail ? { r: p.r, e: p.e as string, x: p.x } : { r: p.r, g: p.g as string, x: p.x };
  } catch {
    return null;
  }
}

function shareUrl(token: string | null): string | null {
  return token ? `${SITE_URL.replace(/\/$/, "")}/r/report/${token}` : null;
}

/** The link to put in this recipient's copy, or null when it cannot be signed. */
export function reportShareUrl(roomCode: string, email: string, now = Date.now()): string | null {
  return shareUrl(signReportShare(roomCode, email, now));
}

/** The link to hand a guest on their way out, or null when it cannot be signed. */
export function guestReportShareUrl(roomCode: string, guestKey: string, now = Date.now()): string | null {
  return shareUrl(signGuestReportShare(roomCode, guestKey, now));
}
