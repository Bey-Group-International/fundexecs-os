// lib/integrations/inbound/types.ts
// Contracts for the inbound webhook surface — the arriving counterpart to the
// DispatchAdapter contract in ../types.ts. Each supported provider registers an
// InboundChannelSpec (verify + map, both pure) in ./index.ts; the generic route
// at app/api/webhooks/[channel] drives them and lib/integrations/inbound/ingest
// persists the result. Keeping verify/map pure means every channel's signature
// scheme and payload shape is unit-tested without a server.
import type { InboxCategory, InboxChannel } from "@/lib/supabase/database.types";

/** The thread an inbound event belongs to (created on first sight of threadKey). */
export interface InboundThreadSeed {
  // The inbox channel the thread renders under. May differ from the webhook
  // channel: Resend inbound email lands on the "gmail" channel — the inbox's
  // email lane, whose replies dispatch through the email adapter.
  channel: InboxChannel;
  category: InboxCategory;
  subject: string;
  counterpartyName: string | null;
  counterpartyEmail: string | null;
  // Provider-side correlation key (inbox_threads.external_id): follow-up events
  // carrying the same key append to this thread instead of minting a new one.
  threadKey: string;
  // Booking/video specifics, when the event carries them.
  meetingAt?: string | null;
  meetingUrl?: string | null;
}

/** The message an inbound event appends to its thread. */
export interface InboundMessageSeed {
  author: string | null;
  body: string;
  // Provider-side occurrence time (ISO); defaults to now() in the DB if absent.
  occurredAt?: string | null;
  // Provenance and provider extras, stored on inbox_messages.metadata.
  metadata?: Record<string, unknown>;
}

/** One verified, mapped webhook event ready to ingest. */
export interface InboundEvent {
  // The provider's event type verbatim ("invitee.created", "email.received").
  eventType: string;
  // The provider's unique id for THIS delivery — the idempotency key
  // (ingest_log.external_id). Distinct from threadKey: many events (created,
  // canceled, replies) can share one thread.
  eventId: string;
  thread: InboundThreadSeed;
  message: InboundMessageSeed;
}

/** A provider's inbound registration: how to verify and how to map. */
export interface InboundChannelSpec {
  // The webhook channel key — the [channel] path segment.
  channel: string;
  // The vault/env key holding this org's webhook signing secret. Resolved via
  // getOrgSecret first (per-org), then process.env (deploy-wide fallback). No
  // secret anywhere → the route fails closed with 401; unsigned payloads are
  // never ingested.
  secretKey: string;
  // Verify the raw request body against the provider's signature headers.
  // Must be timing-safe. Pure: all inputs are passed in.
  verify(rawBody: string, headers: Headers, secret: string, nowMs?: number): boolean;
  // Map a verified payload to an ingestable event, or null when the event type
  // is one this channel deliberately ignores (acknowledged, not ingested).
  // Throws on malformed payloads of a supported type.
  map(payload: unknown): InboundEvent | null;
}
