"use server";

import { getInvoiceByToken } from "@/lib/invoices.server";
import { invoiceTotalCents, isPayable } from "@/lib/invoices";
import { stripeConfigured, createCheckout } from "@/lib/stripe";

// Start Stripe Checkout for a public invoice link. Everything that determines
// the charge — amount, currency, title — is re-derived from the stored invoice
// HERE (server-side, token-gated), so the browser can't tamper with what it pays.
// Returns a client_secret for the in-app modal, or a hosted Checkout URL to
// redirect to when no publishable key is configured.
export async function startInvoiceCheckout(
  token: string,
): Promise<{ clientSecret?: string; checkoutUrl?: string; error?: string }> {
  const invoice = await getInvoiceByToken(token);
  if (!invoice) return { error: "This invoice link isn’t available." };
  if (!isPayable(invoice.status)) {
    return {
      error:
        invoice.status === "paid"
          ? "This invoice has already been paid."
          : "This invoice can no longer be paid.",
    };
  }
  if (!stripeConfigured()) {
    return { error: "Payments aren’t configured for this invoice yet." };
  }

  const amountCents = invoiceTotalCents(invoice.line_items);
  const res = await createCheckout({
    kind: "invoice",
    orgId: invoice.organization_id,
    createdBy: invoice.created_by,
    invoiceId: invoice.id,
    token: invoice.token,
    title: invoice.number ? `${invoice.number} · ${invoice.title}` : invoice.title,
    amountCents,
    currency: invoice.currency,
    customerEmail: invoice.customer_email,
  });
  return res.error
    ? { error: res.error }
    : { clientSecret: res.clientSecret, checkoutUrl: res.url };
}
