"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";

// In-app Stripe Embedded Checkout. The payment form renders inside FundExecs
// (Stripe mounts a secure iframe — card data never touches our code), and Stripe
// processes the charge on the backend. On completion Stripe redirects the top
// frame to the session's return_url (our /api/stripe/return fulfillment route).
//
// stripePromise is cached per publishable key so Stripe.js loads once.
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripePromise(publishableKey: string): Promise<Stripe | null> {
  let p = stripeCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripeCache.set(publishableKey, p);
  }
  return p;
}

export function StripeCheckoutModal({
  clientSecret,
  publishableKey,
  onClose,
}: {
  clientSecret: string;
  publishableKey: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative my-8 w-full max-w-xl rounded-2xl border border-line bg-surface-1 p-2 shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            Secure checkout
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout"
            className="rounded-md px-2 py-1 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
          >
            ✕
          </button>
        </div>
        {publishableKey ? (
          <div className="overflow-hidden rounded-xl bg-white">
            <EmbeddedCheckoutProvider
              stripe={stripePromise(publishableKey)}
              options={{ clientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-status-danger">
            Stripe publishable key isn’t configured, so the in-app form can’t load. Set
            STRIPE_PUBLISHABLE_KEY to enable checkout.
          </p>
        )}
      </div>
    </div>
  );
}
