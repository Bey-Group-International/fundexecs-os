// lib/integrations/inbound/calendly.ts
// Calendly inbound: invitee.created / invitee.canceled webhook events become
// booking threads in the Unified Inbox. Signature scheme per Calendly's webhook
// docs: a `Calendly-Webhook-Signature` header of the form `t=<unix>,v1=<hex>`,
// where v1 is HMAC-SHA256 over `<t>.<rawBody>` with the subscription's signing
// key. Verification is timing-safe and rejects stale timestamps to blunt
// replay.
import { createHmac, timingSafeEqual } from "crypto";
import type { InboundChannelSpec, InboundEvent } from "./types";

// Reject signatures older than this — generous for provider retries, tight
// enough that a captured request can't be replayed indefinitely.
const TOLERANCE_MS = 5 * 60 * 1000;

export function verifyCalendlySignature(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const header = headers.get("calendly-webhook-signature");
  if (!header || !secret) return false;

  let timestamp = "";
  let signature = "";
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t") timestamp = value?.trim() ?? "";
    if (key?.trim() === "v1") signature = value?.trim() ?? "";
  }
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts * 1000) > TOLERANCE_MS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// The slice of Calendly's v2 webhook payload we read. Everything optional —
// map() degrades to readable placeholders rather than throwing on partial data.
interface CalendlyPayload {
  event?: string;
  created_at?: string;
  payload?: {
    uri?: string;
    name?: string;
    email?: string;
    cancel_url?: string;
    reschedule_url?: string;
    cancellation?: { reason?: string; canceled_by?: string };
    scheduled_event?: {
      uri?: string;
      name?: string;
      start_time?: string;
      location?: { join_url?: string; location?: string };
    };
  };
}

const SUPPORTED = new Set(["invitee.created", "invitee.canceled"]);

export function mapCalendlyEvent(raw: unknown): InboundEvent | null {
  const body = (raw ?? {}) as CalendlyPayload;
  const eventType = body.event ?? "";
  if (!SUPPORTED.has(eventType)) return null;

  const invitee = body.payload ?? {};
  const scheduled = invitee.scheduled_event ?? {};
  // The scheduled event URI is Calendly's stable id for the booking — created
  // and canceled events for one booking share it, so they share one thread.
  const threadKey = scheduled.uri ?? invitee.uri;
  if (!threadKey) throw new Error("calendly payload has no scheduled_event.uri");

  const who = invitee.name ?? invitee.email ?? "An invitee";
  const eventName = scheduled.name ?? "a meeting";
  const startTime = scheduled.start_time ?? null;
  const when = startTime ? new Date(startTime).toUTCString() : "an unconfirmed time";
  const canceled = eventType === "invitee.canceled";

  const bodyText = canceled
    ? `${who} canceled "${eventName}"${invitee.cancellation?.reason ? ` — ${invitee.cancellation.reason}` : ""}.`
    : `${who} booked "${eventName}" for ${when}.`;

  return {
    eventType,
    // One delivery per (booking, lifecycle step): the invitee URI alone would
    // collide across created/canceled, so the event type disambiguates.
    eventId: `${invitee.uri ?? threadKey}:${eventType}`,
    thread: {
      channel: "calendly",
      category: "booking",
      subject: `Booking: ${eventName}`,
      counterpartyName: invitee.name ?? null,
      counterpartyEmail: invitee.email ?? null,
      threadKey,
      // A cancellation clears the held time; a booking sets it.
      meetingAt: canceled ? null : startTime,
      meetingUrl: canceled ? null : (scheduled.location?.join_url ?? null),
    },
    message: {
      author: invitee.name ?? invitee.email ?? null,
      body: bodyText,
      occurredAt: body.created_at ?? null,
      metadata: {
        via: "calendly",
        event: eventType,
        invitee_uri: invitee.uri ?? null,
        reschedule_url: invitee.reschedule_url ?? null,
        cancel_url: invitee.cancel_url ?? null,
      },
    },
  };
}

export const calendlyInbound: InboundChannelSpec = {
  channel: "calendly",
  secretKey: "CALENDLY_WEBHOOK_SECRET",
  verify: verifyCalendlySignature,
  map: mapCalendlyEvent,
};
