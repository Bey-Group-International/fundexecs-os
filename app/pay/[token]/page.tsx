import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { stripeConfigured, stripePublishableKeyValue } from "@/lib/stripe";
import { getInvoiceByToken } from "@/lib/invoices.server";
import {
  formatMoney,
  invoiceTotalCents,
  lineItemSubtotalCents,
  isPayable,
} from "@/lib/invoices";
import { facilitatedPaymentHref, FACILITATED_PAYMENT_REL } from "@/lib/payment-links";
import { PayExperience } from "./PayExperience";

// Public, no-login invoice pay page — the link2pay "shareable payment link" idea
// on our stack. Lives OUTSIDE the authed (app) group so anyone with the token
// can pay. The invoice is resolved by token via the service-role client
// (RLS-bypassing); the token is the sole gate. Money runs through the same
// Stripe Embedded Checkout the wallet uses.
export const dynamic = "force-dynamic";

function Unavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
        FundExecs OS
      </span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">
        This invoice isn&apos;t available
      </h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        The payment link is invalid, has been voided, or is no longer active. Ask
        the sender for a fresh link.
      </p>
    </main>
  );
}

export default async function InvoicePayPage(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ checkout?: string }>;
}) {
  const { token } = await props.params;
  const searchParams = await props.searchParams;

  if (!hasSupabaseServiceEnv()) return <Unavailable />;

  const invoice = await getInvoiceByToken(token);
  if (!invoice) return <Unavailable />;

  // Merchant name for the header (best-effort; the invoice renders regardless).
  let merchant: string | null = null;
  try {
    const service = createServiceClient();
    const { data: org } = await service
      .from("organizations")
      .select("name")
      .eq("id", invoice.organization_id)
      .maybeSingle();
    merchant = (org as { name?: string } | null)?.name ?? null;
  } catch {
    merchant = null;
  }

  const total = invoiceTotalCents(invoice.line_items);
  const paid = invoice.status === "paid";
  const payable = isPayable(invoice.status);
  const justPaid = searchParams?.checkout === "paid";

  // WICG facilitated-payment: when the merchant attached a push-payment method
  // URI, advertise it in <head> so a compatible browser/wallet can offer that
  // rail. React 19 hoists this <link> element into the document head.
  const facilitatedHref = facilitatedPaymentHref(invoice.facilitated_payment_url);

  return (
    <main className="min-h-screen bg-surface-0 text-fg-primary">
      {/* WICG facilitated-payment: React 19 hoists this <link> into <head>. */}
      {facilitatedHref ? <link rel={FACILITATED_PAYMENT_REL} href={facilitatedHref} /> : null}

      <div className="mx-auto max-w-lg px-6 py-12">
        <header className="mb-6 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            {merchant ? `Invoice from ${merchant}` : "Invoice"}
          </span>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg-primary">
            {invoice.title}
          </h1>
          {invoice.number ? (
            <p className="mt-1 font-mono text-xs uppercase tracking-wider text-fg-muted">
              {invoice.number}
            </p>
          ) : null}
        </header>

        {paid ? (
          <div className="mb-6 rounded-xl border border-status-success/40 bg-status-success/10 px-4 py-3 text-center text-sm text-fg-primary">
            {justPaid ? "Thank you — your payment was received." : "This invoice has been paid."}
          </div>
        ) : justPaid ? (
          <div className="mb-6 rounded-xl border border-status-success/40 bg-status-success/10 px-4 py-3 text-center text-sm text-fg-primary">
            Payment received — finalizing your receipt.
          </div>
        ) : null}

        <section className="rounded-2xl border border-line bg-surface-1 p-5">
          {invoice.description ? (
            <p className="mb-4 text-sm text-fg-secondary">{invoice.description}</p>
          ) : null}

          {invoice.customer_name || invoice.customer_email ? (
            <p className="mb-4 text-xs text-fg-muted">
              Billed to {invoice.customer_name ?? invoice.customer_email}
              {invoice.customer_name && invoice.customer_email
                ? ` · ${invoice.customer_email}`
                : ""}
            </p>
          ) : null}

          <ul className="flex flex-col divide-y divide-line">
            {invoice.line_items.map((item, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="text-sm text-fg-primary">
                  {item.description}
                  <span className="ml-2 font-mono text-[11px] text-fg-muted">
                    {item.quantity} × {formatMoney(item.unitAmountCents, invoice.currency)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm text-fg-secondary">
                  {formatMoney(lineItemSubtotalCents(item), invoice.currency)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="font-mono text-xs uppercase tracking-wider text-fg-muted">
              Total due
            </span>
            <span className="font-display text-2xl font-semibold text-fg-primary">
              {formatMoney(total, invoice.currency)}
            </span>
          </div>

          {invoice.due_date ? (
            <p className="mt-2 text-right text-[11px] text-fg-muted">Due {invoice.due_date}</p>
          ) : null}
        </section>

        {payable ? (
          <div className="mt-6">
            <PayExperience
              token={invoice.token}
              amountCents={total}
              currency={invoice.currency}
              live={stripeConfigured()}
              publishableKey={stripePublishableKeyValue()}
            />
          </div>
        ) : null}

        <footer className="mt-10 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fg-muted">
            Powered by FundExecs OS
          </span>
        </footer>
      </div>
    </main>
  );
}
