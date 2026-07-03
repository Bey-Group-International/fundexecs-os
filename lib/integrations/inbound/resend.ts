// lib/integrations/inbound/resend.ts
// Resend inbound: `email.received` webhook events become messaging threads in
// the Unified Inbox — the first time external email can ARRIVE in the OS.
// Threads land on the inbox's "gmail" channel (the email lane, whose replies
// dispatch through the email adapter); provenance is recorded as
// metadata.via = "resend" on every message.
//
// Resend signs webhooks with the Svix scheme: `svix-id`, `svix-timestamp`, and
// `svix-signature` headers, where the signature is base64(HMAC-SHA256 over
// `<id>.<timestamp>.<rawBody>`) keyed by the base64-decoded secret after its
// `whsec_` prefix. The signature header can carry several space-separated
// `v1,<sig>` candidates during secret rotation; any one matching passes.
import { createHmac, timingSafeEqual } from "crypto";
import type { InboundChannelSpec, InboundEvent } from "./types";

const TOLERANCE_MS = 5 * 60 * 1000;

export function verifyResendSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts * 1000) > TOLERANCE_MS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  for (const candidate of signatureHeader.split(" ")) {
    const [version, sig] = candidate.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return false;
}

// The slice of Resend's inbound payload we read.
interface ResendPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    text?: string;
    html?: string;
  };
}

// "Re: Re: Fwd: subject" → "subject", lowercased — so a reply threads with the
// original instead of opening a sibling thread per prefix variant.
export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const stripped = s.replace(/^(re|fwd?|fw)\s*:\s*/i, "");
    if (stripped === s) break;
    s = stripped;
  }
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// "Jane Doe <jane@fund.com>" → { name: "Jane Doe", email: "jane@fund.com" }.
export function parseAddress(from: string): { name: string | null; email: string | null } {
  const match = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return { name: name || null, email: match[2].trim().toLowerCase() };
  }
  const bare = from.trim();
  return bare.includes("@") ? { name: null, email: bare.toLowerCase() } : { name: bare || null, email: null };
}

export function mapResendEvent(raw: unknown): InboundEvent | null {
  const body = (raw ?? {}) as ResendPayload;
  // Delivery-status events (email.sent, email.bounced, …) are outbound
  // lifecycle, not arriving mail — acknowledged and ignored here.
  if (body.type !== "email.received") return null;

  const data = body.data ?? {};
  if (!data.email_id) throw new Error("resend payload has no data.email_id");

  const { name, email } = parseAddress(data.from ?? "");
  const subject = data.subject?.trim() || "(no subject)";
  const text = (data.text ?? "").trim() || "(empty message)";

  return {
    eventType: body.type,
    eventId: data.email_id,
    thread: {
      channel: "gmail",
      category: "messaging",
      subject,
      counterpartyName: name,
      counterpartyEmail: email,
      // One thread per counterparty per conversation: replies share the
      // normalized subject, so they append instead of fragmenting.
      threadKey: `email:${email ?? "unknown"}:${normalizeSubject(subject)}`,
    },
    message: {
      author: name ?? email,
      body: text,
      occurredAt: body.created_at ?? null,
      metadata: {
        via: "resend",
        email_id: data.email_id,
        to: Array.isArray(data.to) ? data.to : data.to ? [data.to] : [],
      },
    },
  };
}

export const resendInbound: InboundChannelSpec = {
  channel: "resend",
  secretKey: "RESEND_WEBHOOK_SECRET",
  verify: verifyResendSignature,
  map: mapResendEvent,
};
