// Stripe as a CHARGE RAIL for the native subscription engine.
//
// FundExecs owns the subscription lifecycle (lib/subscriptions +
// lib/subscriptions.server): when a period ends, what a plan change costs, when
// to retry a failed charge. Stripe's job here is narrower — collect one payment
// and save the card so the renewal sweep can charge it off-session. That is why
// a plan checkout runs in `mode: "payment"` rather than `mode: "subscription"`:
// two systems each running their own billing schedule would inevitably disagree
// about when a period ends, and the operator would be the one who found out.
//
// Only STRIPE_SECRET_KEY is required. With STRIPE_PUBLISHABLE_KEY also set the
// payment form renders in-app (Embedded Checkout); without it we fall back to
// hosted Checkout on Stripe's own domain, which needs no publishable key — so a
// half-configured deployment can still sell, instead of dead-ending at a modal
// that cannot load. With no secret at all, stripeConfigured() is false and the
// native rail settles in-app (lib/billing-rail).
//
// Fulfillment is driven by the success redirect (we verify payment_status server
// side), so no webhook secret is needed. The optional webhook route additionally
// fulfills — and keeps legacy Stripe-managed subscriptions renewing — when
// STRIPE_WEBHOOK_SECRET is configured.
import Stripe from "stripe";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { purchaseGift } from "@/lib/gift-earn";
import { markInvoicePaid } from "@/lib/invoices.server";
import { addPack } from "@/lib/purchase";
import { startSubscription, savePaymentMethod } from "@/lib/subscriptions.server";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";

type HeaderStore = {
  get(name: string): string | null;
};

// Read keys trimmed — values pasted into env UIs frequently carry a trailing
// newline/space, which Stripe rejects as "Invalid API Key".
function secretKey(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() ?? "";
}
export function stripePublishableKeyValue(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
}

export function stripeConfigured(): boolean {
  return secretKey().length > 0;
}

// Whether the payment form can render INSIDE the app. Embedded Checkout mounts
// Stripe.js in the browser, which needs the publishable key; without it we use
// hosted Checkout instead. Callers use this to decide which UI to prepare, never
// to decide whether payment is possible.
export function embeddedCheckoutAvailable(): boolean {
  return stripeConfigured() && stripePublishableKeyValue().length > 0;
}

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  const key = secretKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  // Catch the most common misconfiguration: a publishable key pasted into the
  // secret slot. Stripe would just say "Invalid API Key"; this is clearer.
  if (key.startsWith("pk_")) {
    throw new Error(
      "STRIPE_SECRET_KEY looks like a publishable key (pk_…). Use the secret key (sk_… or rk_…).",
    );
  }
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

// Absolute base URL for Checkout success/cancel redirects. Prefer the request's
// own origin so previews and localhost work, then the configured app URL.
function appBaseUrl(): string {
  const h = headers() as unknown as HeaderStore;
  const origin = h.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const host = h.get("host");
  if (host) {
    const proto = host.startsWith("localhost") ? "http" : "https";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://fundexecs.com";
}

// What a Checkout Session is buying. The discriminant + fields are also written
// to the session metadata so fulfillment is self-contained.
export type CheckoutIntent =
  | { kind: "plan"; orgId: string; createdBy: string | null; planKey: PlanKey; interval: PlanInterval }
  | { kind: "pack"; orgId: string; createdBy: string | null; packKey: string }
  | {
      kind: "gift";
      orgId: string;
      createdBy: string | null;
      packKey: string;
      recipientEmail: string;
      message?: string;
    }
  // A payment-link invoice. `orgId` is the MERCHANT (whose Stripe account
  // collects); the payer is anyone with the link, so amount/title/currency are
  // derived server-side from the stored invoice by the caller (lib/invoices.server
  // + the public pay action) — never trusted from the browser.
  | {
      kind: "invoice";
      orgId: string;
      createdBy: string | null;
      invoiceId: string;
      token: string;
      title: string;
      amountCents: number;
      currency: string;
      customerEmail?: string | null;
    };

// Build a Checkout Session for an intent and record it pending.
//
// Returns EITHER a `clientSecret` (Embedded Checkout — the payment form renders
// inside FundExecs, no redirect) or a `url` (hosted Checkout on Stripe's domain),
// depending on whether a publishable key is configured. Callers must handle both:
// a deployment with only a secret key still needs to be able to take money, and
// before this fallback existed it dead-ended at a modal that could not load.
//
// Either way Stripe sends the browser to our fulfillment route when payment
// completes. Any Stripe/DB failure is caught and returned as a friendly { error }
// so the caller can surface it inline instead of crashing the page.
export async function createCheckout(
  intent: CheckoutIntent,
): Promise<{ clientSecret?: string; url?: string; error?: string }> {
  const base = appBaseUrl();
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    // Surface the specific misconfiguration (e.g. wrong key type); fall back to
    // a generic "not configured" message.
    const msg = err instanceof Error ? err.message : "";
    return {
      error: msg.includes("publishable key")
        ? msg
        : "Payments aren’t configured. Set STRIPE_SECRET_KEY to enable checkout.",
    };
  }

  let params: Stripe.Checkout.SessionCreateParams;
  let amountUsd = 0;
  const metadata: Record<string, string> = {
    kind: intent.kind,
    org_id: intent.orgId,
    created_by: intent.createdBy ?? "",
  };

  if (intent.kind === "plan") {
    const plan = PLAN_BY_KEY[intent.planKey];
    if (!plan) return { error: "Unknown plan" };
    amountUsd = intent.interval === "annual" ? plan.annual : plan.monthly;
    metadata.plan_key = plan.key;
    metadata.interval = intent.interval;
    params = {
      // One payment for THIS period — not a Stripe subscription. The renewal is
      // ours to schedule (lib/subscriptions.server), so what we need from
      // checkout is the first charge plus a reusable payment method.
      mode: "payment",
      // A customer is required to charge off-session later; Checkout will not
      // create one for a guest payment unless we ask.
      customer_creation: "always",
      payment_intent_data: {
        // Consent to charge this card again without the cardholder present.
        // Renewals fail closed without it.
        setup_future_usage: "off_session",
        description: `FundExecs OS — ${plan.name} plan (${intent.interval})`,
        metadata: {
          org_id: intent.orgId,
          plan_key: plan.key,
          interval: intent.interval,
          created_by: intent.createdBy ?? "",
        },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountUsd * 100),
            product_data: {
              name: `FundExecs OS — ${plan.name} plan`,
              description:
                intent.interval === "annual"
                  ? "One year of access, renewing annually"
                  : "One month of access, renewing monthly",
            },
          },
        },
      ],
    };
  } else if (intent.kind === "pack") {
    const pack = CREDIT_PACKS.find((p) => p.key === intent.packKey);
    if (!pack) return { error: "Unknown credit pack" };
    amountUsd = pack.price;
    metadata.pack_key = pack.key;
    params = {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(pack.price * 100),
            product_data: { name: `${pack.credits.toLocaleString()} credit pack` },
          },
        },
      ],
    };
  } else if (intent.kind === "gift") {
    const pack = CREDIT_PACKS.find((p) => p.key === intent.packKey);
    if (!pack) return { error: "Pick a credit pack to gift." };
    const email = intent.recipientEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return { error: "Enter a valid recipient email." };
    amountUsd = pack.price;
    metadata.pack_key = pack.key;
    metadata.recipient_email = email;
    if (intent.message) metadata.message = intent.message.slice(0, 400);
    params = {
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(pack.price * 100),
            product_data: { name: `Gift: ${pack.credits.toLocaleString()} FundExecs credits` },
          },
        },
      ],
    };
  } else {
    // Invoice. One-off payment for a server-derived amount; token + invoice_id
    // travel in metadata so fulfillment can flip the row and the return route can
    // bounce back to the public pay page.
    if (!Number.isFinite(intent.amountCents) || intent.amountCents <= 0) {
      return { error: "This invoice has no payable amount." };
    }
    amountUsd = intent.amountCents / 100;
    metadata.invoice_id = intent.invoiceId;
    metadata.token = intent.token;
    params = {
      mode: "payment",
      ...(intent.customerEmail ? { customer_email: intent.customerEmail } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (intent.currency || "usd").toLowerCase(),
            unit_amount: Math.round(intent.amountCents),
            product_data: { name: intent.title.slice(0, 250) || "Invoice" },
          },
        },
      ],
    };
  }

  const embedded = embeddedCheckoutAvailable();
  const returnPath = `${base}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      ...params,
      client_reference_id: intent.orgId,
      metadata,
      ...(embedded
        ? // Embedded Checkout redirects the top frame here once payment completes.
          { ui_mode: "embedded" as const, return_url: returnPath }
        : // Hosted Checkout takes the browser to Stripe and back. `cancel_url`
          // must land somewhere sane, since the operator has left our app.
          {
            ui_mode: "hosted" as const,
            success_url: returnPath,
            cancel_url: `${base}${cancelPathFor(intent)}?checkout=cancelled`,
          }),
    });
  } catch (err) {
    return { error: friendlyStripeError(err) };
  }

  const handoff = embedded
    ? { clientSecret: session.client_secret ?? undefined }
    : { url: session.url ?? undefined };
  if (!handoff.clientSecret && !handoff.url) {
    return { error: "Stripe did not return a checkout session. Please try again." };
  }

  // Record the pending checkout so fulfillment is single-shot and auditable.
  try {
    const service = createServiceClient();
    await service.from("stripe_checkouts").insert({
      organization_id: intent.orgId,
      session_id: session.id,
      kind: intent.kind,
      amount_usd: amountUsd,
      status: "pending",
      metadata,
      created_by: intent.createdBy,
    });
  } catch {
    // Non-fatal: fulfillment can still proceed from the session metadata on
    // return. Don't block the purchase on the audit-row write.
  }

  return handoff;
}

// Where hosted Checkout returns an operator who backed out. Each purchase starts
// from a different page, and dumping everyone on /wallet would lose an in-progress
// gift or an invoice payer's link.
function cancelPathFor(intent: CheckoutIntent): string {
  switch (intent.kind) {
    case "gift":
      return "/gift";
    case "invoice":
      return `/pay/${intent.token}`;
    default:
      return "/wallet";
  }
}

// Map a Stripe SDK error to a safe, user-facing message — never echoing the key
// or raw internals. Logged server-side for diagnosis.
function friendlyStripeError(err: unknown): string {
  const type = (err as { type?: string })?.type;
  const code = (err as { code?: string })?.code;
  console.error("[stripe] checkout session creation failed:", type ?? "", code ?? "", err);
  if (type === "StripeAuthenticationError") {
    return "Payment provider rejected the API key. Please check the Stripe configuration.";
  }
  return "We couldn’t start checkout. Please try again in a moment.";
}

// Create a Stripe Customer Portal session for an org that already has a
// stripe_customer_id. Returns the portal URL (redirect the browser there) or
// an error string. The portal lets users cancel, swap plans, and update cards
// without any custom UI on our side.
export async function createPortalSession(
  orgId: string,
  returnPath = "/wallet",
): Promise<{ url?: string; error?: string }> {
  const service = createServiceClient();
  const { data: wallet } = await service
    .from("wallets")
    .select("stripe_customer_id")
    .eq("organization_id", orgId)
    .maybeSingle();

  const customerId = (wallet as { stripe_customer_id?: string | null } | null)
    ?.stripe_customer_id;
  if (!customerId) {
    return { error: "No billing account found. Subscribe to a plan first." };
  }

  try {
    const stripe = getStripe();
    const base = appBaseUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}${returnPath}`,
    });
    return { url: session.url };
  } catch (err) {
    console.error("[stripe] portal session creation failed:", err);
    return { error: "Could not open billing portal. Please try again." };
  }
}

// The payment method Checkout saved for future off-session charges. Reads it
// from the session's PaymentIntent; returns null when the session had none (a
// zero-amount session, or a rail that does not save instruments).
async function paymentMethodFromSession(
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  const pi = session.payment_intent;
  if (!pi) return null;
  if (typeof pi !== "string") {
    return typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  }
  try {
    const intent = await getStripe().paymentIntents.retrieve(pi);
    return typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id ?? null;
  } catch (err) {
    // A missing instrument only costs us the ability to auto-renew, which the
    // dunning path already reports to the operator. Never fail the purchase.
    console.error("[stripe] could not read the saved payment method:", err);
    return null;
  }
}

export interface FulfillResult {
  ok: boolean;
  kind?: string;
  error?: string;
  alreadyFulfilled?: boolean;
  /** Invoice public token, so the return route can redirect back to /pay/<token>. */
  token?: string;
}

// Verify a completed Checkout Session and apply its effect exactly once. Safe to
// call from both the success redirect and the optional webhook.
//
// `expectedOrgId`, when supplied (the success-redirect path knows the caller's
// org), must match the org that initiated the checkout. Fulfillment always
// targets the session's OWN org regardless, so this is defense-in-depth: it
// stops an authenticated user from triggering fulfillment of another org's
// session id. The webhook path omits it (no caller context).
export async function fulfillCheckout(
  sessionId: string,
  expectedOrgId?: string,
): Promise<FulfillResult> {
  if (!sessionId) return { ok: false, error: "Missing session id" };
  const service = createServiceClient();

  const { data: row } = await service
    .from("stripe_checkouts")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (row?.status === "fulfilled") {
    const token = (row.metadata as { token?: string } | null)?.token;
    return { ok: true, kind: row.kind, alreadyFulfilled: true, token };
  }

  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const paid = session.payment_status === "paid" || session.status === "complete";
  if (!paid) return { ok: false, error: "Payment not completed" };

  const meta = (session.metadata ?? {}) as Record<string, string>;
  const orgId = meta.org_id || row?.organization_id;
  const kind = meta.kind || row?.kind;
  if (!orgId || !kind) return { ok: false, error: "Checkout is missing fulfillment metadata" };
  // Invoices are public-payable BY DESIGN (any signed-in user, from any org, or
  // an anonymous payer), so the org-binding defense doesn't apply to them. For
  // plan/pack/gift it still stops a user triggering fulfillment of another org's
  // session id.
  if (expectedOrgId && kind !== "invoice" && orgId !== expectedOrgId) {
    return { ok: false, error: "Checkout session does not belong to this organization" };
  }
  const createdBy = meta.created_by || null;

  if (kind === "plan") {
    const planKey = meta.plan_key as PlanKey;
    const plan = PLAN_BY_KEY[planKey];
    const interval: PlanInterval = meta.interval === "annual" ? "annual" : "monthly";
    if (plan) {
      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : (session.customer as { id?: string } | null)?.id ?? null;
      // The card the operator just used, saved via setup_future_usage. Without
      // it the subscription starts but can never renew, so pull it off the
      // PaymentIntent while we have the session in hand.
      const paymentMethodId = await paymentMethodFromSession(session);

      // Hand the period to the native engine: it owns the schedule from here.
      // `alreadyPaid` because checkout just collected this period — charging
      // the rail again would bill twice.
      const result = await startSubscription({
        orgId,
        planKey,
        interval,
        createdBy,
        processor: "stripe",
        processorCustomerId: stripeCustomerId,
        paymentMethodId,
        reference: session.payment_intent
          ? typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent.id
          : session.id,
        alreadyPaid: true,
        note: `${plan.name} plan (${interval}) — Stripe`,
      });
      if (!result.ok) {
        console.error("[stripe] subscription start after checkout failed:", result.error);
      }
      // Persist the instrument even when the subscription already existed (a
      // re-subscribe, or a card update), so renewals use the newest card.
      await savePaymentMethod(service, orgId, paymentMethodId, stripeCustomerId);
    }
  } else if (kind === "pack") {
    const pack = CREDIT_PACKS.find((p) => p.key === meta.pack_key);
    if (pack) {
      await addPack(service, orgId, pack.key, { note: `${pack.credits} credit pack — Stripe` });
    }
  } else if (kind === "gift") {
    // The gift only exists once paid: create it now so it's redeemable.
    await purchaseGift({
      senderOrgId: orgId,
      createdBy,
      recipientEmail: meta.recipient_email ?? "",
      packKey: meta.pack_key ?? "",
      message: meta.message,
    });
  } else if (kind === "invoice") {
    // Flip the merchant's invoice to paid (idempotent) and record the linkage.
    if (meta.invoice_id) {
      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent as { id?: string } | null)?.id ?? null;
      await markInvoicePaid(meta.invoice_id, { sessionId: session.id, paymentIntent });
    }
  }

  await service
    .from("stripe_checkouts")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
    .eq("session_id", sessionId);

  return { ok: true, kind, token: meta.token };
}
