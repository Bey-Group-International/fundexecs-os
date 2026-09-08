"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { formatCredits, formatUsd, PLAN_BY_KEY, type PlanKey } from "@/lib/billing";
import {
  daysUntilDue,
  invoiceHealth,
  paymentReferenceFor,
  type RemittanceDetails,
  type SubscriptionInvoice,
} from "@/lib/subscription-invoices";
import { settlementSummary } from "@/lib/native-payments";
import { payInvoiceByCardAction } from "./actions";

const StripeCheckoutModal = dynamic(
  () => import("@/components/StripeCheckoutModal").then((m) => m.StripeCheckoutModal),
  { ssr: false },
);

// The bill for the current period, and the two ways to settle it: a transfer
// (the native path — the money arrives directly, no processor takes a cut) or a
// card, which is the fallback for anyone who needs the plan to start today.
export function InvoicePanel({
  invoice,
  remittance,
  cardAvailable,
  publishableKey = "",
}: {
  invoice: SubscriptionInvoice;
  remittance: RemittanceDetails | null;
  cardAvailable: boolean;
  publishableKey?: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const health = invoiceHealth(invoice);
  // A debit already collecting: the operator has nothing to do, and must not be
  // shown wire instructions or a card button that would take the money twice.
  const collecting = invoice.status === "processing";
  const settlement = settlementSummary(invoice);
  const days = daysUntilDue(invoice, new Date());
  const plan = PLAN_BY_KEY[invoice.plan as PlanKey];
  const reference = paymentReferenceFor(invoice);

  function payByCard() {
    setError(null);
    startTransition(async () => {
      const res = await payInvoiceByCardAction(invoice.id);
      if (res?.clientSecret) setClientSecret(res.clientSecret);
      else if (res?.checkoutUrl) window.location.href = res.checkoutUrl;
      else setError(res?.error ?? "Could not start card checkout.");
    });
  }

  return (
    <section
      className={`fx-neural-panel p-5 sm:p-6 ${health === "overdue" ? "border-status-danger/40" : ""}`}
    >
      {clientSecret ? (
        <StripeCheckoutModal
          clientSecret={clientSecret}
          publishableKey={publishableKey}
          onClose={() => setClientSecret(null)}
        />
      ) : null}

      <div className="relative z-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
              Invoice {invoice.number}
            </p>
            <p className="mt-1.5 font-display text-2xl font-semibold text-fg-primary">
              {formatUsd(invoice.amount_usd)}
              <span className="ml-2 font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-fg-muted">
                {plan?.name ?? invoice.plan} · {invoice.interval}
              </span>
            </p>
            <p className="mt-2 text-sm text-fg-secondary">
              {collecting ? (
                settlement
              ) : health === "overdue" ? (
                <span className="text-status-danger">
                  {Math.abs(days)} day(s) overdue.
                </span>
              ) : (
                <>Due in {days} day(s).</>
              )}{" "}
              {!collecting && (
                <>{formatCredits(invoice.credits)} credits are released when payment clears.</>
              )}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] ${
              health === "overdue"
                ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
                : health === "due_soon"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  : "border-line/60 bg-surface-2/40 text-fg-secondary"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {collecting ? "Collecting" : health === "overdue" ? "Overdue" : "Awaiting payment"}
          </span>
        </div>

        {/* A previous debit that bounced: say so plainly, above the ways to fix it. */}
        {!collecting && invoice.settlement_failure ? (
          <p className="mt-4 rounded-xl border border-status-danger/40 bg-status-danger/[0.07] px-4 py-3 text-sm text-status-danger">
            {invoice.settlement_failure}
          </p>
        ) : null}

        {collecting ? null : remittance ? (
          <div className="mt-5 rounded-xl border border-line/50 bg-surface-1/40 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300/70">
              Pay by transfer
            </p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Detail label="Bank" value={remittance.bankName} />
              <Detail label="Account name" value={remittance.accountName} />
              <Detail label="Account number" value={remittance.accountNumber} mono />
              {remittance.routingNumber ? (
                <Detail label="Routing / ABA" value={remittance.routingNumber} mono />
              ) : null}
              {remittance.swift ? <Detail label="SWIFT / BIC" value={remittance.swift} mono /> : null}
              {/* The reference is how a wire gets matched back to this bill. */}
              <Detail label="Reference (required)" value={reference} mono highlight />
            </dl>
            {remittance.notes ? (
              <p className="mt-3 text-xs text-fg-muted">{remittance.notes}</p>
            ) : null}
            <p className="mt-3 text-xs text-fg-muted">
              Quote <span className="font-mono text-gold-300">{reference}</span> on the transfer so
              we can match it. Your plan continues while this invoice is within its terms; credits
              are added once the payment is confirmed.
            </p>
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-line/50 bg-surface-1/40 px-4 py-3 text-sm text-fg-secondary">
            Transfer details aren&apos;t configured for this workspace yet — pay by card below, or
            contact support for remittance instructions.
          </p>
        )}

        {cardAvailable && !collecting && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={payByCard}
              className="rounded-lg bg-neural-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-neural-300 disabled:opacity-60"
            >
              {pending ? "Opening checkout…" : `Pay ${formatUsd(invoice.amount_usd)} by card instead`}
            </button>
            <span className="text-xs text-fg-muted">
              Card payment settles immediately — use it if you need the credits today.
            </span>
          </div>
        )}

        {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}
      </div>
    </section>
  );
}

function Detail({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">{label}</dt>
      <dd
        className={`mt-0.5 ${mono ? "font-mono" : ""} ${
          highlight ? "text-gold-300" : "text-fg-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
