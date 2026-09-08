"use client";

import { useState, useTransition } from "react";
import type { AdminInvoiceRow } from "@/lib/admin/subscription-invoices";
import { formatUsd, formatCredits } from "@/lib/billing";
import { daysUntilDue, invoiceHealth } from "@/lib/subscription-invoices";
import { confirmSubscriptionPaymentAction } from "./actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Outstanding subscription bills, oldest due date first. Confirming one here is
// what releases the period's credits, so each row asks for the payment
// reference: without it there is nothing tying the grant to a real transfer.
export function SubscriptionInvoicesTable({
  open,
  settled,
}: {
  open: AdminInvoiceRow[];
  settled: AdminInvoiceRow[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm(id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await confirmSubscriptionPaymentAction(id, refs[id] ?? "");
      if (res?.error) setError(res.error);
      else setRefs((r) => ({ ...r, [id]: "" }));
      setPendingId(null);
    });
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-gold-300/70">
        Subscription invoices · {open.length} outstanding
      </h2>

      {open.length === 0 ? (
        <p className="rounded-2xl border border-line/60 bg-surface-1/30 px-4 py-3 text-sm text-fg-secondary">
          Nothing outstanding. Every issued subscription invoice has been settled.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line/60 bg-surface-1/30">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line/50 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Confirm payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {open.map((inv) => {
                const health = invoiceHealth(inv);
                const days = daysUntilDue(inv, new Date());
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 font-mono text-xs text-fg-primary">{inv.number}</td>
                    <td className="px-4 py-3 text-fg-secondary">
                      {inv.organization_name ?? (
                        <span className="font-mono text-xs text-fg-muted">{inv.organization_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-secondary">
                      {inv.plan} · {inv.interval}
                      <span className="ml-2 font-mono text-[11px] text-gold-300">
                        +{formatCredits(inv.credits)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg-primary">
                      {formatUsd(inv.amount_usd)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          health === "overdue"
                            ? "text-status-danger"
                            : health === "due_soon"
                              ? "text-amber-300"
                              : "text-fg-secondary"
                        }
                      >
                        {fmtDate(inv.due_at)}
                        <span className="ml-1.5 font-mono text-[11px]">
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={refs[inv.id] ?? ""}
                          onChange={(e) => setRefs((r) => ({ ...r, [inv.id]: e.target.value }))}
                          placeholder="Wire / transfer reference"
                          aria-label={`Payment reference for ${inv.number}`}
                          className="w-48 rounded-lg border border-line/60 bg-surface-0 px-2.5 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted"
                        />
                        <button
                          type="button"
                          disabled={pending && pendingId === inv.id}
                          onClick={() => confirm(inv.id)}
                          className="rounded-lg bg-neural-400 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neural-300 disabled:opacity-60"
                        >
                          {pending && pendingId === inv.id ? "Recording…" : "Mark received"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}

      {settled.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            Recently settled
          </h3>
          <ul className="divide-y divide-line/40 overflow-hidden rounded-2xl border border-line/60 bg-surface-1/20">
            {settled.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-xs">
                <span className="font-mono text-fg-primary">{inv.number}</span>
                <span className="text-fg-secondary">{inv.organization_name ?? "—"}</span>
                <span className="tabular-nums text-fg-secondary">{formatUsd(inv.amount_usd)}</span>
                <span className="text-fg-muted">via {inv.paid_via ?? "—"}</span>
                {inv.payment_reference ? (
                  <span className="font-mono text-fg-muted">ref {inv.payment_reference}</span>
                ) : null}
                <span className="ml-auto font-mono text-fg-muted">{fmtDate(inv.paid_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
