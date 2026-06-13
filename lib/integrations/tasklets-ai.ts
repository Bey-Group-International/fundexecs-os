import 'server-only';

/* ============================================================================
 * lib/integrations/tasklets-ai.ts — fire-and-forget Tasklets.ai webhook emitter.
 *
 * Tasklets.ai is the routing and scheduling layer between OS intelligence and
 * HighLevel execution. It handles time-based follow-up, segment routing, and
 * content distribution scheduling that require conditional logic outside the
 * operator's real-time approval queue.
 *
 * Configure with two server env vars:
 *   TASKLETS_WEBHOOK_URL     required — the Tasklets.ai inbound webhook
 *   TASKLETS_WEBHOOK_SECRET  optional — sent as `Authorization: Bearer <secret>`
 *
 * NEVER-BLOCK: failures are swallowed. A Tasklets.ai outage must never fail a
 * user-facing action.
 * ========================================================================= */

export type TaskletsAiEventType =
  | 'brand_content_approved'    // Module 3 — schedule approved content into HL calendar
  | 'lead_routed_tasklets'      // Module 4 — route lead to correct platform (Apollo vs HL)
  | 'partner_intro_submitted';  // Module 6 — start 48h follow-up watch

export interface TaskletsAiEvent {
  type: TaskletsAiEventType;
  occurredAt: string;
  /** Flat, JSON-safe payload. */
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 4_000;

/**
 * POST an event to the configured Tasklets.ai webhook. Returns true on 2xx,
 * false on any failure or when unconfigured. Never throws.
 */
export async function emitTaskletsAiEvent(event: TaskletsAiEvent): Promise<boolean> {
  const url = process.env.TASKLETS_WEBHOOK_URL;
  if (!url) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const secret = process.env.TASKLETS_WEBHOOK_SECRET;
    if (secret) headers.authorization = `Bearer ${secret}`;

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
