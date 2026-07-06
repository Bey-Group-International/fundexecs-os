"use client";

import { useState, useTransition } from "react";
import { StripeCheckoutModal } from "@/components/StripeCheckoutModal";
import { formatMoney } from "@/lib/invoices";
import { startInvoiceCheckout } from "./actions";

// The interactive half of the public pay page: a single "Pay" button that opens
// the in-app Stripe Embedded Checkout for this invoice. The invoice details
// themselves render server-side (page.tsx); this only owns the payment action.
export function PayExperience({
  token,
  amountCents,
  currency,
  live,
  publishableKey,
}: {
  token: string;
  amountCents: number;
  currency: string;
  live: boolean;
  publishableKey: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pay() {
    setError(null);
    startTransition(async () => {
      const res = await startInvoiceCheckout(token);
      if (res?.clientSecret) setClientSecret(res.clientSecret);
      else setError(res?.error ?? "Could not start checkout. Please try again.");
    });
  }

  return (
    <div>
      {clientSecret ? (
        <StripeCheckoutModal
          clientSecret={clientSecret}
          publishableKey={publishableKey}
          onClose={() => setClientSecret(null)}
        />
      ) : null}

      <button
        type="button"
        onClick={pay}
        disabled={pending || !live}
        aria-busy={pending}
        className="w-full rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-3 text-center font-medium text-fg-primary transition hover:border-gold-500/70 hover:bg-gold-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Opening secure checkout…" : `Pay ${formatMoney(amountCents, currency)}`}
      </button>

      {error ? <p className="mt-3 text-center text-xs text-status-danger">{error}</p> : null}
      <p className="mt-3 text-center text-[11px] text-fg-muted">
        {live
          ? "Secure checkout by Stripe. Your card details never touch this site."
          : "Payments are being configured for this invoice. Please check back shortly."}
      </p>
    </div>
  );
}
