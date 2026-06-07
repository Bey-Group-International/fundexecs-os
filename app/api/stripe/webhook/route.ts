import Stripe from 'stripe';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/* ============================================================================
 * app/api/stripe/webhook/route.ts — Stripe → wallet credit reconciliation.
 *
 * On `checkout.session.completed`, credits the org's wallet by calling the
 * `record_credit_topup` RPC (service role) with the session's metadata. The RPC
 * is idempotent on `stripe_session_id`, so Stripe's at-least-once delivery
 * never double-grants.
 *
 * Env-gated: returns 503 (not an error page) when billing keys are absent, so
 * the route is build-safe on deployments without Stripe configured.
 * ========================================================================= */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveEnv(suffix: string): string | undefined {
  const exact = process.env[suffix];
  if (exact) return exact;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const secretKey = resolveEnv('STRIPE_SECRET_KEY');
  const webhookSecret = resolveEnv('STRIPE_WEBHOOK_SECRET');
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature.';
    return NextResponse.json({ error: `Webhook verification failed: ${message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.org_id ?? session.client_reference_id ?? null;
    const amountCredits = Number(session.metadata?.amount_credits ?? 0);
    const amountCents = Number(session.metadata?.amount_cents ?? session.amount_total ?? 0);

    if (!orgId || amountCredits <= 0) {
      // Nothing actionable — ack so Stripe stops retrying.
      return NextResponse.json({ received: true, skipped: 'missing org_id or credits' });
    }

    try {
      const admin = createAdminClient();
      const { error } = await admin.rpc('record_credit_topup', {
        _org_id: orgId,
        _amount_credits: amountCredits,
        _amount_cents: amountCents,
        _stripe_session_id: session.id,
        _status: 'succeeded',
        _metadata: {
          payment_intent:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          customer_email: session.customer_details?.email ?? null
        }
      });
      if (error) {
        // 500 → Stripe retries; the RPC is idempotent so retries are safe.
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record top-up.';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
