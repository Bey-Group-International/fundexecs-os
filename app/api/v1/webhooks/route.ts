import { NextResponse } from "next/server";
import { collection, failure, withApiKey } from "@/lib/api-v1";
import {
  MAX_ENDPOINTS_PER_ORG,
  generateWebhookSecret,
  parseWebhookSubscription,
} from "@/lib/webhooks-outbound";
import { encryptSecret, vaultConfigured } from "@/lib/vault";

// /api/v1/webhooks — outbound event subscriptions (scope events:subscribe).
//
//   curl -X POST https://app.fundexecs.com/api/v1/webhooks \
//     -H "Authorization: Bearer fxsk_live_…" -H "Content-Type: application/json" \
//     -d '{"url": "https://example.com/hooks/fundexecs", "events": ["task.completed"]}'
//
// The hourly sweep delivers matching task-engine and dispatch events as one
// signed batch POST per endpoint. Verify with the whsec_… secret returned once
// here: signature = "v1=" + hex(HMAC-SHA256(secret, timestamp + "." + body)),
// against the fx-webhook-timestamp and fx-webhook-signature headers.
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ orgId, supabase }) => {
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(
      "id, url, description, events, secret_last4, disabled_at, consecutive_failures, last_delivery_at, last_delivery_status, created_at",
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return failure(error.message, 500);

  return collection(
    (data ?? []).map((e) => ({
      id: e.id,
      url: e.url,
      description: e.description,
      events: e.events,
      secret_last4: e.secret_last4,
      disabled: e.disabled_at !== null,
      consecutive_failures: e.consecutive_failures,
      last_delivery_at: e.last_delivery_at,
      last_delivery_status: e.last_delivery_status,
      created_at: e.created_at,
    })),
  );
}, "events:subscribe");

export const POST = withApiKey(async ({ orgId, supabase }, request) => {
  // The signing secret is stored encrypted; without the vault key there is
  // nothing safe to store, so refuse up front rather than accept-and-never-sign.
  if (!vaultConfigured()) {
    return failure("Webhook subscriptions are unavailable (vault not configured)", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Request body must be JSON", 400);
  }
  const parsed = parseWebhookSubscription(body);
  if (!parsed.ok) return failure(parsed.error, 422);

  const { count } = await supabase
    .from("webhook_endpoints")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if ((count ?? 0) >= MAX_ENDPOINTS_PER_ORG) {
    return failure(`Endpoint limit reached (${MAX_ENDPOINTS_PER_ORG} per organization)`, 422);
  }

  const secret = generateWebhookSecret();
  const encrypted = encryptSecret(secret);
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({
      organization_id: orgId,
      url: parsed.url,
      description: parsed.description,
      events: parsed.events,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      secret_last4: secret.slice(-4),
    })
    .select("id, url, events, created_at")
    .single();
  if (error || !data) return failure(error?.message ?? "Could not create the endpoint", 500);

  // The full secret is returned exactly once — only its encrypted form and a
  // display fragment are ever stored.
  return NextResponse.json(
    {
      data: {
        id: data.id,
        url: data.url,
        events: data.events,
        secret,
        created_at: data.created_at,
      },
    },
    { status: 201 },
  );
}, "events:subscribe");
