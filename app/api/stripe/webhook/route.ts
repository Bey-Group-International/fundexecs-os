import Stripe from 'stripe';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPlan } from '@/lib/billing/plans';
import { activateGiftBySession } from '@/lib/queries/gift';

/* ============================================================================
 * app/api/stripe/webhook/route.ts — Stripe → wallet + subscription reconciliation.
 *
 * Handles two billing flows, both idempotent against Stripe's at-least-once
 * delivery:
 *   - One-off credit packs (`checkout.session.completed`, mode 'payment') →
 *     `record_credit_topup` RPC (idempotent on stripe_session_id).
 *   - Recurring plans (`checkout.session.completed` mode 'subscription',
 *     `customer.subscription.*`, `invoice.paid`) → upserts `org_subscriptions`
 *     and grants the plan's per-period credits once per invoice (idempotent via
 *     the `subscription_invoices` ledger).
 *
 * Env-gated: returns 503 (not an error page) when billing keys are absent, so
 * the route is build-safe on deployments without Stripe configured.
 * ========================================================================= */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AdminClient = ReturnType<typeof createAdminClient>;

function resolveEnv(suffix: string): string | undefined {
  const exact = process.env[suffix];
  if (exact) return exact;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

/** Unix-seconds → ISO string, or null when absent. */
function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

/** Current period end — lives on the subscription item in recent Stripe API versions. */
function periodEndIso(sub: Stripe.Subscription): string | null {
  return toIso(sub.items?.data?.[0]?.current_period_end);
}

/**
 * Mirror a Stripe Subscription into `org_subscriptions` and reflect the plan on
 * the credit wallet. Driven by metadata stamped at checkout (org/plan/credits).
 */
async function upsertSubscription(admin: AdminClient, sub: Stripe.Subscription): Promise<void> {
  const md = sub.metadata ?? {};
  const orgId = md.org_id;
  if (!orgId) return;

  const planId = getPlan(md.plan)?.id ?? 'free';
  const interval = md.billing_interval === 'year' ? 'year' : 'month';
  const item = sub.items?.data?.[0];
  const seats = Number(md.seats ?? item?.quantity ?? 1);
  const creditsPerPeriod = Number(md.credits_per_period ?? 0);
  const periodEnd = periodEndIso(sub);

  await admin.from('org_subscriptions').upsert(
    {
      org_id: orgId,
      plan: planId,
      billing_interval: interval,
      seats: Number.isFinite(seats) && seats > 0 ? seats : 1,
      status: sub.status,
      credits_per_period: Number.isFinite(creditsPerPeriod) ? creditsPerPeriod : 0,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      current_period_end: periodEnd,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      stripe_subscription_id: sub.id,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'org_id' }
  );

  // Reflect the plan on the wallet so the top-nav gauge shows it.
  await admin.from('credit_wallets').update({ plan: planId }).eq('org_id', orgId);
}

/**
 * Grant a subscription invoice's credits exactly once. Delegates to the
 * `claim_invoice_and_grant` RPC, which claims the invoice (idempotency ledger)
 * and grants the credits inside a single transaction — so a failed grant rolls
 * back the claim and Stripe's retry re-attempts cleanly.
 */
async function grantInvoiceCredits(
  admin: AdminClient,
  invoiceId: string,
  orgId: string,
  credits: number,
  periodEnd: string | null
): Promise<void> {
  if (credits <= 0) return;

  const { error } = await admin.rpc('claim_invoice_and_grant', {
    _stripe_invoice_id: invoiceId,
    _org_id: orgId,
    _amount: credits,
    _period_end: periodEnd ?? undefined,
    _reason: 'subscription_credit'
  });
  if (error) throw new Error(error.message);
}

/**
 * Reconcile a raise reservation's payment status from its Checkout session.
 * Idempotent against Stripe's at-least-once delivery: only flips a row that is
 * still `pending`, so re-delivered events and already-terminal rows no-op.
 */
async function reconcileReservation(
  admin: AdminClient,
  sessionId: string,
  status: 'paid' | 'cancelled'
): Promise<void> {
  // Throw on a real DB error so the handler returns non-200 and Stripe retries
  // (matching grantInvoiceCredits). A 0-row update is the expected idempotent
  // no-op for re-delivered/already-terminal events, so it is not an error.
  const { error } = await admin
    .from('raise_interests')
    .update({ reservation_status: status })
    .eq('stripe_session_id', sessionId)
    .eq('reservation_status', 'pending');
  if (error) throw new Error(error.message);
}

/**
 * Best-effort: pay the referrer a commission on a referred org's purchase.
 * Idempotent and a no-op when the org wasn't referred — so it never blocks (or
 * double-grants on retry) the buyer's own credits. Failures are logged, not
 * thrown, so a commission hiccup can't fail the whole webhook.
 */
async function payReferralCommission(
  admin: AdminClient,
  referredOrgId: string,
  sourceRef: string,
  credits: number
): Promise<void> {
  if (credits <= 0) return;
  const { error } = await admin.rpc('grant_referral_commission', {
    _referred_org_id: referredOrgId,
    _source_ref: sourceRef,
    _credits_purchased: credits
  });
  if (error) console.error('[stripe] referral commission failed:', error.message);
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

  try {
    const admin = createAdminClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // One-off credit pack → credit the wallet.
        if (session.mode === 'payment') {
          // Gift purchases don't credit the buyer — activate the gift + email
          // the recipient (idempotent). They redeem the credits themselves.
          if (session.metadata?.kind === 'gift') {
            await activateGiftBySession(session.id);
            break;
          }

          // Raise reservation deposit → mark the reservation paid (idempotent).
          // Only flip once the session is actually paid; delayed/async methods
          // settle via checkout.session.async_payment_succeeded below.
          if (session.metadata?.kind === 'raise_reservation') {
            if (session.payment_status === 'paid') {
              await reconcileReservation(admin, session.id, 'paid');
            }
            break;
          }

          const orgId = session.metadata?.org_id ?? session.client_reference_id ?? null;
          const amountCredits = Number(session.metadata?.amount_credits ?? 0);
          const amountCents = Number(session.metadata?.amount_cents ?? session.amount_total ?? 0);
          if (!orgId || amountCredits <= 0) {
            return NextResponse.json({ received: true, skipped: 'missing org_id or credits' });
          }
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
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
          await payReferralCommission(admin, orgId, session.id, amountCredits);
          break;
        }

        // New subscription → record its state (credits land on invoice.paid).
        if (session.mode === 'subscription' && session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscription(admin, sub);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await upsertSubscription(admin, sub);
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription ended — remove the row so getOrgSubscription treats the
        // org as unsubscribed (configured:false), letting them start a fresh
        // checkout instead of being routed to the billing portal.
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.org_id;
        if (orgId) {
          await admin.from('org_subscriptions').delete().eq('org_id', orgId);
          await admin.from('credit_wallets').update({ plan: 'free' }).eq('org_id', orgId);
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = (invoice as unknown as { subscription?: string | { id: string } })
          .subscription;
        const subId = typeof subRef === 'string' ? subRef : subRef?.id;
        if (!subId || !invoice.id) break;

        const sub = await stripe.subscriptions.retrieve(subId);
        await upsertSubscription(admin, sub);

        const orgId = sub.metadata?.org_id;
        const credits = Number(sub.metadata?.credits_per_period ?? 0);
        if (orgId && credits > 0) {
          await grantInvoiceCredits(admin, invoice.id, orgId, credits, periodEndIso(sub));
          await payReferralCommission(admin, orgId, invoice.id, credits);
        }
        break;
      }

      // Delayed payment methods settle later — mark the reservation paid then.
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind === 'raise_reservation') {
          await reconcileReservation(admin, session.id, 'paid');
        }
        break;
      }

      // Abandoned or failed reservation checkout → release it as cancelled.
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.kind === 'raise_reservation') {
          await reconcileReservation(admin, session.id, 'cancelled');
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // 500 → Stripe retries; every handler above is idempotent so retries are safe.
    const message = err instanceof Error ? err.message : 'Failed to process webhook.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
