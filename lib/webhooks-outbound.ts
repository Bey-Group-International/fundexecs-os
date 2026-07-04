// Outbound webhooks for the v1 API (audit P2 — API-surface design: event
// subscriptions delivered from task_events/dispatch_log by the cron sweep,
// HMAC-signed).
//
// Three pieces:
//   1. Subscription shape: the event-type catalog, body validation for
//      POST /api/v1/webhooks, and whsec_… secret generation.
//   2. Signing: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")> — the same
//      scheme our inbound verifiers check (Calendly/Stripe convention), so
//      integrators verify deliveries with the snippet they already have.
//   3. runWebhookDeliveries: the sweep. Per active endpoint, collect events
//      past its cursor from task_events (+ dispatch_log as "dispatch.sent"),
//      deliver one signed batch, and advance the cursor only on a 2xx — a
//      failed delivery retries the same window next sweep, and repeated
//      failures auto-disable the endpoint so it can't burn every future run.
import { createHmac, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, WebhookEndpoint } from "@/lib/supabase/database.types";
import { decryptSecret } from "@/lib/vault";

type Client = SupabaseClient<Database>;

// The deliverable catalog: the task-engine event types (0007_task_engine.sql)
// plus "dispatch.sent" synthesized from dispatch_log rows.
export const WEBHOOK_EVENT_TYPES = [
  "task.created",
  "task.progress",
  "task.completed",
  "task.handoff",
  "approval.requested",
  "approval.response",
  "artifact.created",
  "graph.update",
  "dispatch.sent",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** Endpoints allowed per org — enough for real integrations, a hard stop for
 * scripts creating one per run. */
export const MAX_ENDPOINTS_PER_ORG = 10;

// Bounds per sweep: events per endpoint per delivery, endpoints per run, and
// the failure streak that flips an endpoint off.
const MAX_EVENTS_PER_DELIVERY = 50;
const MAX_ENDPOINTS_PER_SWEEP = 50;
export const DISABLE_AFTER_FAILURES = 20;
const DELIVERY_TIMEOUT_MS = 10_000;

export type SubscriptionParse =
  | { ok: true; url: string; events: string[]; description: string | null }
  | { ok: false; error: string };

/** Validate a POST /api/v1/webhooks body. HTTPS only — a signed payload over
 * plaintext HTTP would leak both the events and material for replay. */
export function parseWebhookSubscription(body: unknown): SubscriptionParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const { url, events, description, ...rest } = body as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) return { ok: false, error: `Unknown field: ${unknown[0]}` };

  if (typeof url !== "string" || url.length > 2000) {
    return { ok: false, error: "Field url must be a string (max 2000 chars)" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Field url must be a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Field url must be https://" };
  }

  let eventList: string[] = [];
  if (events !== undefined && events !== null) {
    if (!Array.isArray(events) || events.some((e) => typeof e !== "string")) {
      return { ok: false, error: "Field events must be an array of event types" };
    }
    const bad = (events as string[]).find((e) => !isWebhookEventType(e));
    if (bad) {
      return { ok: false, error: `Unknown event type: ${bad}. Known: ${WEBHOOK_EVENT_TYPES.join(", ")}` };
    }
    eventList = [...new Set(events as string[])];
  }

  if (description !== undefined && description !== null && typeof description !== "string") {
    return { ok: false, error: "Field description must be a string" };
  }
  const desc = typeof description === "string" ? description.slice(0, 500) : null;

  return { ok: true, url, events: eventList, description: desc };
}

/** Mint a signing secret. whsec_ prefix is the convention integrators expect. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** Signature over "<timestamp>.<rawBody>" — verify with the same recipe. */
export function signWebhookPayload(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

interface OutboundEvent {
  id: string;
  type: string;
  created_at: string;
  data: Json;
}

// Collect an endpoint's undelivered events: task_events after the cursor, plus
// dispatch_log rows surfaced as "dispatch.sent". Merged oldest-first so the
// cursor (max created_at of what we deliver) never skips anything.
async function collectEvents(
  supabase: Client,
  orgId: string,
  cursorAt: string,
): Promise<OutboundEvent[]> {
  const [taskEvents, dispatches] = await Promise.all([
    supabase
      .from("task_events")
      .select("id, event_type, task_id, agent, hub, payload, created_at")
      .eq("organization_id", orgId)
      .gt("created_at", cursorAt)
      .order("created_at", { ascending: true })
      .limit(MAX_EVENTS_PER_DELIVERY),
    supabase
      .from("dispatch_log")
      .select("id, action, channel, live, ok, detail, reference, task_id, created_at")
      .eq("organization_id", orgId)
      .gt("created_at", cursorAt)
      .order("created_at", { ascending: true })
      .limit(MAX_EVENTS_PER_DELIVERY),
  ]);

  const events: OutboundEvent[] = [];
  for (const e of taskEvents.data ?? []) {
    events.push({
      id: e.id,
      type: e.event_type,
      created_at: e.created_at,
      data: {
        task_id: e.task_id,
        agent: e.agent,
        hub: e.hub,
        payload: e.payload,
      } as unknown as Json,
    });
  }
  for (const d of dispatches.data ?? []) {
    events.push({
      id: d.id,
      type: "dispatch.sent",
      created_at: d.created_at,
      data: {
        action: d.action,
        channel: d.channel,
        live: d.live,
        ok: d.ok,
        detail: d.detail,
        reference: d.reference,
        task_id: d.task_id,
      } as unknown as Json,
    });
  }

  events.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return events.slice(0, MAX_EVENTS_PER_DELIVERY);
}

export interface DeliveryStats {
  endpoints: number;
  delivered: number;
  failed: number;
  disabled: number;
}

/**
 * The cron-sweep delivery pass. Best-effort throughout: one endpoint's failure
 * never blocks another's delivery, and any throw is contained by the caller's
 * try/catch (mirrors the radar/SLA blocks in /api/cron).
 */
export async function runWebhookDeliveries(
  supabase: Client,
  now: Date = new Date(),
): Promise<DeliveryStats> {
  const stats: DeliveryStats = { endpoints: 0, delivered: 0, failed: 0, disabled: 0 };

  const { data } = await supabase
    .from("webhook_endpoints")
    .select("*")
    .is("disabled_at", null)
    .order("last_delivery_at", { ascending: true, nullsFirst: true })
    .limit(MAX_ENDPOINTS_PER_SWEEP);
  const endpoints = (data ?? []) as WebhookEndpoint[];
  stats.endpoints = endpoints.length;

  for (const endpoint of endpoints) {
    try {
      const all = await collectEvents(supabase, endpoint.organization_id, endpoint.cursor_at);
      const events =
        endpoint.events.length > 0 ? all.filter((e) => endpoint.events.includes(e.type)) : all;

      // Filtered-out events still advance the cursor — they are not "pending",
      // the endpoint just doesn't want them. Without this, one unsubscribed
      // event type at the head of the window would wedge the cursor forever.
      const windowEnd = all.length > 0 ? all[all.length - 1].created_at : null;
      if (events.length === 0) {
        if (windowEnd) {
          await supabase
            .from("webhook_endpoints")
            .update({ cursor_at: windowEnd })
            .eq("id", endpoint.id);
        }
        continue;
      }

      let secret: string;
      try {
        secret = decryptSecret({
          ciphertext: endpoint.ciphertext,
          iv: endpoint.iv,
          authTag: endpoint.auth_tag,
        });
      } catch {
        // Vault key missing/rotated — deliveries can't be signed. Leave the
        // endpoint alone (no failure strike: this is our config, not theirs).
        continue;
      }

      const body = JSON.stringify({
        delivered_at: now.toISOString(),
        count: events.length,
        events,
      });
      const timestamp = Math.floor(now.getTime() / 1000);

      let ok = false;
      let statusLabel = "";
      try {
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "fx-webhook-id": endpoint.id,
            "fx-webhook-timestamp": String(timestamp),
            "fx-webhook-signature": signWebhookPayload(secret, timestamp, body),
          },
          body,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        ok = res.ok;
        statusLabel = `${res.status}`;
      } catch (err) {
        statusLabel = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable";
      }

      if (ok) {
        stats.delivered += 1;
        await supabase
          .from("webhook_endpoints")
          .update({
            cursor_at: windowEnd ?? endpoint.cursor_at,
            consecutive_failures: 0,
            last_delivery_at: now.toISOString(),
            last_delivery_status: `ok (${events.length} events)`,
          })
          .eq("id", endpoint.id);
      } else {
        stats.failed += 1;
        const failures = endpoint.consecutive_failures + 1;
        const disable = failures >= DISABLE_AFTER_FAILURES;
        if (disable) stats.disabled += 1;
        await supabase
          .from("webhook_endpoints")
          .update({
            // Cursor NOT advanced — the same window retries next sweep.
            consecutive_failures: failures,
            last_delivery_at: now.toISOString(),
            last_delivery_status: `failed (${statusLabel})`,
            ...(disable ? { disabled_at: now.toISOString() } : {}),
          })
          .eq("id", endpoint.id);
      }
    } catch (err) {
      console.error("webhook delivery failed for endpoint", endpoint.id, err);
    }
  }

  return stats;
}
