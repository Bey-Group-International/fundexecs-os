/**
 * Provider-agnostic shapes for the relationship-intelligence ingestion
 * pipeline. Every integration (Gmail, Calendar, Calendly, Slack, Apollo, …)
 * maps its raw data into these, which are then normalized into the
 * `contacts` / `interactions` tables. The DB trigger scores `relationships`.
 */

export type InteractionType =
  | 'email_sent'
  | 'email_received'
  | 'meeting'
  | 'call'
  | 'message'
  | 'calendar_event'
  | 'note';

export type InteractionDirection = 'inbound' | 'outbound' | 'internal';

export interface NormalizedContact {
  email?: string;
  fullName?: string;
  company?: string;
  title?: string;
}

export interface NormalizedInteraction {
  /** Used to resolve the contact_id after contacts are upserted. */
  contactEmail?: string;
  type: InteractionType;
  direction: InteractionDirection;
  /** ISO timestamp. */
  occurredAt: string;
  subject?: string;
  summary?: string;
  /** Stable provider id for idempotent upserts (e.g. message/event id). */
  externalRef: string;
}

export interface ProviderSignals {
  contacts: NormalizedContact[];
  interactions: NormalizedInteraction[];
}

export interface FetchContext {
  /** OAuth access token for the provider (e.g. Google `provider_token`). */
  token: string;
  /** Only fetch signals newer than this ISO timestamp, when supported. */
  since?: string;
  /** The connected user's own email, to infer direction and skip self. */
  userEmail?: string;
}

export interface Provider {
  id: string;
  label: string;
  /** Whether this provider can run with the current request context. */
  fetchSignals(ctx: FetchContext): Promise<ProviderSignals>;
}
