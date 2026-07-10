// app/api/webhooks/[channel]/route.ts
// The generic inbound webhook surface — the first external channel INTO the OS.
// Providers POST here (Calendly invitee events, Resend inbound email); the
// event is signature-verified against the org's own vault secret, mapped to a
// {thread, message} pair by the channel's registered spec
// (lib/integrations/inbound), deduplicated via the append-only ingest_log, and
// landed in the Unified Inbox.
//
// URL shape: /api/webhooks/{channel}?org={organizationId}. The org configures
// this URL at the provider when it creates the webhook subscription, and stores
// the provider's signing secret in the settings vault (CALENDLY_WEBHOOK_SECRET /
// RESEND_WEBHOOK_SECRET) — falling back to the deploy-wide env var for
// single-tenant installs. No secret configured → 401: unsigned payloads are
// never ingested, mirroring the Stripe webhook's fail-closed posture.
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrgSecret } from "@/lib/org-secrets";
import { getInboundChannel } from "@/lib/integrations/inbound";
import { ingestInboundEvent } from "@/lib/integrations/inbound/ingest";
import { refreshThreadSummary } from "@/lib/inbox/data";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WebhookErrorResponse {
  error: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  const spec = getInboundChannel(channel);
  if (!spec) {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Unknown webhook channel" },
      { status: 404 },
    );
  }

  const orgId = req.nextUrl.searchParams.get("org") ?? "";
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Missing or invalid org parameter" },
      { status: 400 },
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Ingestion is not configured" },
      { status: 503 },
    );
  }

  // Per-org vault secret wins; deploy-wide env is the single-tenant fallback.
  // A vault read failure must not silently downgrade verification to the env
  // secret for an org that HAS its own — fail the request instead.
  let secret: string | null = null;
  try {
    secret = await getOrgSecret(orgId, spec.secretKey);
  } catch {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Credential resolution failed" },
      { status: 503 },
    );
  }
  secret = secret ?? process.env[spec.secretKey] ?? null;
  if (!secret) {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Webhook signing secret not configured" },
      { status: 401 },
    );
  }

  const rawBody = await req.text();
  if (!spec.verify(rawBody, req.headers, secret)) {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  // From here the payload is authenticated. Map it; a null map result is a
  // deliberately-ignored event type — acknowledged so the provider stops
  // retrying, but nothing is written.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Malformed JSON payload" },
      { status: 400 },
    );
  }

  let event;
  try {
    event = spec.map(payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unmappable payload";
    return NextResponse.json<WebhookErrorResponse>({ error: detail }, { status: 422 });
  }
  if (!event) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const supabase = createServiceClient();

  // The org must exist — a signed request against a mistyped org id should
  // fail loudly at configuration time, not create orphaned rows.
  const org = await supabase.from("organizations").select("id").eq("id", orgId).maybeSingle();
  if (org.error || !org.data) {
    return NextResponse.json<WebhookErrorResponse>(
      { error: "Unknown organization" },
      { status: 404 },
    );
  }

  const result = await ingestInboundEvent(supabase, orgId, spec.channel, event);
  if (!result.ok) {
    // 500 so the provider retries — the ingest_log row records the failure.
    return NextResponse.json<WebhookErrorResponse>({ error: result.error }, { status: 500 });
  }
  if (result.duplicate) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Refresh the thread's AI summary + intent now that a new message has landed —
  // one summarization per delivery, cached on the row. Best-effort by contract
  // (it swallows its own failures), so the webhook is already acknowledged from
  // the caller's perspective even if the model is slow or unavailable.
  await refreshThreadSummary(supabase, orgId, result.threadId);

  return NextResponse.json({
    received: true,
    threadId: result.threadId,
    created: result.created,
  });
}
