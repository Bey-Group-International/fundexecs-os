"use client";

// Status banner shown after returning from Stripe Checkout (?checkout=…). Pure
// presentation; the actual fulfillment happens server-side on the return route.
export function CheckoutBanner({ status }: { status?: string }) {
  if (status === "success") {
    return (
      <div className="mb-4 rounded-xl border border-status-success/40 bg-status-success/10 px-4 py-3 text-sm text-status-success">
        Payment complete — your purchase has been applied. It may take a moment to appear.
      </div>
    );
  }
  if (status === "cancelled") {
    return (
      <div className="mb-4 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
        Checkout cancelled — nothing was charged.
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="mb-4 rounded-xl border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
        We couldn’t confirm that payment. If you were charged, it’ll be reconciled shortly —
        otherwise please try again.
      </div>
    );
  }
  return null;
}
