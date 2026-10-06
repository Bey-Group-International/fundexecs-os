// lib/meetings/report-share.server.ts
// A private, expiring link to a meeting's report, for the person it was emailed to.
//
// The summary email ended with "View the full report", a link into the app that
// opens only for a signed-in member of the organization who was in the meeting.
// Every external invitee — the people the email is mostly for — met a login
// wall. Each copy of the email now carries its own signed link instead: it names
// the meeting and the recipient, expires, and opens a read-only summary (no
// transcript, chat or recording) without an account.
//
// Signed with a key derived from the service-role key, as the data-room gate
// does, so nothing new needs provisioning: the page reads with the service role,
// so it cannot work anywhere that key is missing anyway.

import { createHmac, timingSafeEqual } from "crypto";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { SITE_URL } from "@/lib/site";

/** How long a shared report link keeps working. */
export const REPORT_SHARE_TTL_MS = 30 * 86_400_000;

export interface ReportSharePayload {
  /** The meeting's room code. */
  r: string;
  /** The recipient's address, lowercased. */
  e: string;
  /** Expiry, epoch ms. */
  x: number;
}

function shareSecret(): string | null {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base) return null;
  return createHmac("sha256", "fx-meeting-report-share").update(base).digest("hex");
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** A token for this meeting and recipient, or null when links cannot be signed here. */
export function signReportShare(roomCode: string, email: string, now = Date.now()): string | null {
  const secret = shareSecret();
  const e = normalizeEmail(email);
  if (!secret || !roomCode || !e) return null;
  const payload: ReportSharePayload = { r: roomCode, e, x: now + REPORT_SHARE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** The payload of a genuine, unexpired token; null for anything else. */
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
    if (typeof p.r !== "string" || typeof p.e !== "string" || typeof p.x !== "number") return null;
    if (p.x <= now) return null;
    return { r: p.r, e: p.e, x: p.x };
  } catch {
    return null;
  }
}

/** The link to put in this recipient's copy, or null when it cannot be signed. */
export function reportShareUrl(roomCode: string, email: string, now = Date.now()): string | null {
  const token = signReportShare(roomCode, email, now);
  return token ? `${SITE_URL.replace(/\/$/, "")}/r/report/${token}` : null;
}
