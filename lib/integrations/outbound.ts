import 'server-only';

/* ============================================================================
 * lib/integrations/outbound.ts — fire-and-forget outbound webhook for CRM sync.
 *
 * THE single place the product pushes beta lifecycle events (new lead, access
 * approved/declined) to an external destination — a CRM, a Zapier/Make hook, an
 * internal Slack relay. Configure the destination with two server env vars:
 *
 *   OUTBOUND_WEBHOOK_URL     required — the HTTPS endpoint to POST events to
 *   OUTBOUND_WEBHOOK_SECRET  optional — sent as `Authorization: Bearer <secret>`
 *
 * When `OUTBOUND_WEBHOOK_URL` is unset the emitter is a no-op, so this is safe
 * to call unconditionally. It is NEVER-BLOCK: every failure path (no config,
 * network error, non-2xx, timeout) is swallowed so a webhook outage can never
 * fail a real signup or an admin's access decision.
 * ========================================================================= */

/** A beta lifecycle event pushed to the configured CRM/webhook. */
export interface OutboundEvent {
  /** Stable event name: 'access_request' | 'access_approved' | 'access_rejected' | 'access_pending'. */
  type: string;
  /** ISO timestamp the event occurred. */
  occurredAt: string;
  /** Event payload — flat, JSON-safe, no secrets. */
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 4000;

/**
 * POST an event to the configured outbound webhook. Resolves to `true` when the
 * endpoint accepted it (2xx), `false` on any failure or when unconfigured.
 * Never throws — callers can `void emitOutboundEvent(...)` without a try/catch.
 */
export async function emitOutboundEvent(event: OutboundEvent): Promise<boolean> {
  const url = process.env.OUTBOUND_WEBHOOK_URL;
  if (!url) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const secret = process.env.OUTBOUND_WEBHOOK_SECRET;
    if (secret) headers.authorization = `Bearer ${secret}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: controller.signal
    });
    return res.ok;
  } catch {
    // Never-block: a webhook outage must not fail the primary action.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
