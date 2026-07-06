"use client";

import { useMemo, useState, useTransition } from "react";
import {
  formatMoney,
  invoiceTotalCents,
  INVOICE_STATUS_LABEL,
  type PaymentInvoice,
  type PaymentInvoiceLineItem,
} from "@/lib/invoices";
import { createInvoiceAction, voidInvoiceAction } from "./invoice-actions";

// Merchant surface for payment-link invoices (Execute › Invoices). Draft an
// invoice with line items and get a shareable /pay/<token> link anyone can pay
// via Stripe. Payment, status flips, and receipts are handled server-side; this
// only creates, lists, copies, and voids.

interface DraftRow {
  description: string;
  quantity: string; // form strings; parsed on submit
  unitDollars: string;
}

const EMPTY_ROW: DraftRow = { description: "", quantity: "1", unitDollars: "" };

function payUrl(token: string): string {
  if (typeof window === "undefined") return `/pay/${token}`;
  return `${window.location.origin}/pay/${token}`;
}

export function ExecuteBilling({
  initialInvoices,
  live,
}: {
  initialInvoices: PaymentInvoice[];
  live: boolean;
}) {
  const [invoices, setInvoices] = useState<PaymentInvoice[]>(initialInvoices);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [facilitatedUrl, setFacilitatedUrl] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([{ ...EMPTY_ROW }]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const previewCents = useMemo(() => {
    const items: PaymentInvoiceLineItem[] = rows.map((r) => ({
      description: r.description,
      quantity: Number(r.quantity) || 0,
      unitAmountCents: Math.round((Number(r.unitDollars) || 0) * 100),
    }));
    return invoiceTotalCents(items);
  }, [rows]);

  function updateRow(i: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setCustomerName("");
    setCustomerEmail("");
    setDueDate("");
    setFacilitatedUrl("");
    setRows([{ ...EMPTY_ROW }]);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createInvoiceAction({
        title,
        description: description || null,
        customerName: customerName || null,
        customerEmail: customerEmail || null,
        dueDate: dueDate || null,
        facilitatedPaymentUrl: facilitatedUrl || null,
        currency: "usd",
        lineItems: rows.map((r) => ({
          description: r.description,
          quantity: Number(r.quantity) || 0,
          unitAmountCents: Math.round((Number(r.unitDollars) || 0) * 100),
        })),
      });
      if (res.invoice) {
        setInvoices((prev) => [res.invoice as PaymentInvoice, ...prev]);
        resetForm();
      } else {
        setError(res.error ?? "Could not create the invoice.");
      }
    });
  }

  function copyLink(token: string) {
    const url = payUrl(token);
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(token);
        setTimeout(() => setCopied((c) => (c === token ? null : c)), 1600);
      },
      () => setCopied(null),
    );
  }

  function voidInvoice(id: string) {
    startTransition(async () => {
      const res = await voidInvoiceAction(id);
      if (res.ok) {
        setInvoices((prev) =>
          prev.map((inv) => (inv.id === id ? { ...inv, status: "void" } : inv)),
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Execute · Invoices
        </span>
        <h1 className="mt-2 font-display text-2xl font-semibold text-fg-primary">
          Payment-link invoices
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
          Draft an invoice and share a public pay link — anyone can settle it by
          card through Stripe, no account required. Attach an optional{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
            facilitated-payment
          </code>{" "}
          URI (UPI, crypto, wallet) to advertise an alternate rail per the WICG
          Payment Link spec.
        </p>
        {!live ? (
          <p className="mt-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-fg-secondary">
            Stripe isn’t configured yet, so pay links can’t be settled. You can
            still draft invoices; set STRIPE_SECRET_KEY to enable checkout.
          </p>
        ) : null}
      </header>

      {/* Create form */}
      <section className="rounded-2xl border border-line bg-surface-1 p-5">
        <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-fg-muted">
          New invoice
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-fg-muted">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Advisory retainer — Q3"
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Customer name</span>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Customer email</span>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500/50"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-fg-muted">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Due date (optional)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">Facilitated-payment URI (optional)</span>
            <input
              value={facilitatedUrl}
              onChange={(e) => setFacilitatedUrl(e.target.value)}
              placeholder="upi://pay?pa=you@bank&cu=INR"
              className="rounded-lg border border-line bg-surface-0 px-3 py-2 font-mono text-xs text-fg-primary outline-none focus:border-gold-500/50"
            />
          </label>
        </div>

        {/* Line items */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-fg-muted">
              Line items
            </span>
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary"
            >
              + Add line
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={row.description}
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                  placeholder="Description"
                  className="flex-1 rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500/50"
                />
                <input
                  value={row.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                  inputMode="numeric"
                  aria-label="Quantity"
                  className="w-16 rounded-lg border border-line bg-surface-0 px-2 py-2 text-center text-sm text-fg-primary outline-none focus:border-gold-500/50"
                />
                <div className="flex items-center rounded-lg border border-line bg-surface-0 px-2">
                  <span className="text-sm text-fg-muted">$</span>
                  <input
                    value={row.unitDollars}
                    onChange={(e) => updateRow(i, { unitDollars: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Unit price in dollars"
                    className="w-20 bg-transparent px-1 py-2 text-right text-sm text-fg-primary outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label="Remove line"
                  className="rounded-md px-2 py-1 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-status-danger"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              Total
            </span>
            <span className="ml-2 font-display text-xl font-semibold text-fg-primary">
              {formatMoney(previewCents)}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            aria-busy={pending}
            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm font-medium text-fg-primary transition hover:border-gold-500/70 hover:bg-gold-500/20 disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create invoice"}
          </button>
        </div>
        {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}
      </section>

      {/* Invoice list */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
          Invoices
        </h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-fg-muted">No invoices yet. Create one above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {invoices.map((inv) => {
              const canVoid = inv.status === "open" || inv.status === "draft";
              return (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-1 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-fg-primary">{inv.title}</span>
                      {inv.number ? (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                          {inv.number}
                        </span>
                      ) : null}
                    </div>
                    {inv.customer_name || inv.customer_email ? (
                      <p className="truncate text-xs text-fg-muted">
                        {inv.customer_name ?? inv.customer_email}
                      </p>
                    ) : null}
                  </div>

                  <span className="font-mono text-sm text-fg-secondary">
                    {formatMoney(inv.amount_cents, inv.currency)}
                  </span>

                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      inv.status === "paid"
                        ? "border-status-success/40 bg-status-success/10 text-status-success"
                        : inv.status === "void"
                          ? "border-line bg-surface-2 text-fg-muted"
                          : "border-gold-500/40 bg-gold-500/10 text-gold-300"
                    }`}
                  >
                    {INVOICE_STATUS_LABEL[inv.status]}
                  </span>

                  {inv.status !== "void" ? (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={payUrl(inv.token)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary"
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        onClick={() => copyLink(inv.token)}
                        className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary"
                      >
                        {copied === inv.token ? "Copied" : "Copy link"}
                      </button>
                      {canVoid ? (
                        <button
                          type="button"
                          onClick={() => voidInvoice(inv.id)}
                          disabled={pending}
                          className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-status-danger disabled:opacity-60"
                        >
                          Void
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
