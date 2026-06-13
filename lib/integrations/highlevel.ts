import 'server-only';

/* ============================================================================
 * lib/integrations/highlevel.ts — fire-and-forget HighLevel webhook emitter.
 *
 * HighLevel is the execution layer for outbound sequences, contact tagging, and
 * stakeholder notifications. This module is the ONLY place the product pushes
 * events to HighLevel. Intelligence stays in OS; HighLevel receives triggers.
 *
 * Configure with two server env vars:
 *   HIGHLEVEL_WEBHOOK_URL     required — the HL sub-account inbound webhook
 *   HIGHLEVEL_WEBHOOK_SECRET  optional — sent as `Authorization: Bearer <secret>`
 *
 * NEVER-BLOCK: every failure path is swallowed. A HL outage must never fail a
 * user-facing action.
 * ========================================================================= */

export type HighLevelEventType =
  | 'dataroom_viewed' // Module 2 — LP/prospect viewed a public data room
  | 'lp_interest_signal' // Module 5 — pre-commit LP engagement (view + booking)
  | 'lead_routed_hl' // Module 4 — inbound/lower-touch lead routed to HL sequence
  | 'deal_stage_changed' // Module 7 — deal advanced stage → stakeholder notification
  | 'inbox_warmth_enrolled'; // Module 1 — operator approved HL enrollment for warm contact

export interface HighLevelEvent {
  type: HighLevelEventType;
  occurredAt: string;
  /** Flat, JSON-safe payload — no secrets, no internal IDs beyond what HL needs. */
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 4_000;

/**
 * POST an event to the configured HighLevel webhook. Returns true on 2xx,
 * false on any failure or when unconfigured. Never throws.
 */
export async function emitHighLevelEvent(event: HighLevelEvent): Promise<boolean> {
  const url = process.env.HIGHLEVEL_WEBHOOK_URL;
  if (!url) return false;

  // Only attach the Authorization header over HTTPS (or localhost for local dev)
  // to prevent bearer secret leakage on misconfigured HTTP destinations.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }
  const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  const isHttps = parsedUrl.protocol === 'https:';
  if (!isHttps && !isLocalhost) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const secret = process.env.HIGHLEVEL_WEBHOOK_SECRET;
    if (secret && isHttps) headers.authorization = `Bearer ${secret}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: controller.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
