"use client";

import { useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import type { LinkedAccount, TreasuryTransfer, TransferStatus } from "@/lib/supabase/database.types";
import { linkedAccountLabel, summarizeLinkedAccounts } from "@/lib/treasury/format";
import {
  startBankLinkAction,
  recordLinkedAccountAction,
  disconnectAccountAction,
  createTransferAction,
} from "./treasury-actions";

const fmt = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE: Record<TransferStatus, string> = {
  succeeded: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  processing: "border-gold-400/40 bg-gold-400/10 text-gold-300",
  pending: "border-gold-400/40 bg-gold-400/10 text-gold-300",
  failed: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  canceled: "border-line/40 bg-surface-2/40 text-fg-muted",
};

export function TreasuryPanel({
  accounts,
  transfers,
  publishableKey,
  stripeLive,
}: {
  accounts: LinkedAccount[];
  transfers: TreasuryTransfer[];
  publishableKey: string;
  stripeLive: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [pending, startTransition] = useTransition();

  const summary = summarizeLinkedAccounts(accounts);
  const active = accounts.filter((a) => a.status === "active");

  async function linkBank() {
    setError(null);
    setNotice(null);
    setLinking(true);
    try {
      const { clientSecret, error: startErr } = await startBankLinkAction();
      if (startErr || !clientSecret) {
        setError(startErr ?? "Could not start bank linking.");
        return;
      }
      const stripe = await loadStripe(publishableKey);
      if (!stripe) {
        setError("Stripe failed to load.");
        return;
      }
      const result = await stripe.collectFinancialConnectionsAccounts({ clientSecret });
      if (result.error) {
        setError(result.error.message ?? "Bank linking was canceled.");
        return;
      }
      const linked = result.financialConnectionsSession?.accounts ?? [];
      if (linked.length === 0) {
        setNotice("No accounts were linked.");
        return;
      }
      for (const acc of linked) {
        await recordLinkedAccountAction({
          stripeFcAccountId: acc.id,
          institutionName: acc.institution_name ?? null,
          last4: acc.last4 ?? null,
          accountType: acc.subcategory === "savings" ? "savings" : "checking",
        });
      }
      setNotice(`Linked ${linked.length} account${linked.length === 1 ? "" : "s"}.`);
    } catch {
      setError("Bank linking failed. Please try again.");
    } finally {
      setLinking(false);
    }
  }

  function submitTransfer(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await createTransferAction(formData);
      if (res.error) setError(res.error);
      else setNotice(res.note ?? `Transfer ${res.status}.`);
    });
  }

  function disconnect(accountId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("account_id", accountId);
      const res = await disconnectAccountAction(fd);
      if (res.error) setError(res.error);
    });
  }

  return (
    <section className="fx-neural-panel mt-6 p-5 sm:p-6">
      <div className="relative z-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-neural-300">Treasury</p>
            <h2 className="mt-2 font-display text-xl font-semibold text-fg-primary">Linked accounts &amp; transfers</h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Connect a bank account through Stripe and move funds by ACH. Balances shown are the last reported by
              your bank.
            </p>
          </div>
          <div className="rounded-xl border border-neural-400/25 bg-black/40 px-4 py-2 text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-neural-300">Available</p>
            <p className="mt-1 font-display text-lg font-semibold text-fg-primary">
              {fmt(summary.totalBalanceCents)}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
              {summary.active} active
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
            {notice}
          </p>
        ) : null}

        {/* Linked accounts */}
        <div className="mt-5 grid gap-3">
          {accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line/40 bg-surface-2/20 p-5 text-center text-sm text-fg-secondary">
              No bank accounts linked yet.
            </div>
          ) : (
            accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line/40 bg-surface-2/30 p-4"
              >
                <div>
                  <p className="font-medium text-fg-primary">{linkedAccountLabel(a)}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
                    {a.account_type} · {a.status}
                    {typeof a.balance_cents === "number" ? ` · ${fmt(a.balance_cents)}` : ""}
                  </p>
                </div>
                {a.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => disconnect(a.id)}
                    disabled={pending}
                    className="rounded-lg border border-line/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-secondary transition hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
            ))
          )}

          <button
            type="button"
            onClick={linkBank}
            disabled={linking || !stripeLive}
            className="rounded-xl border border-neural-400/40 bg-neural-400/10 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-neural-200 transition hover:bg-neural-400/20 disabled:opacity-50"
          >
            {linking ? "Opening secure link…" : stripeLive ? "+ Link a bank account" : "Connect Stripe to link a bank"}
          </button>
        </div>

        {/* Transfer form */}
        <form action={submitTransfer} className="mt-6 grid gap-3 rounded-2xl border border-line/40 bg-black/30 p-4 sm:grid-cols-[auto_1fr_auto]">
          <select
            name="direction"
            className="rounded-lg border border-line/50 bg-surface-2/40 px-3 py-2 text-sm text-fg-primary"
          >
            <option value="deposit">Deposit (pull in)</option>
            <option value="withdrawal">Withdraw (send out)</option>
          </select>
          <select
            name="linked_account_id"
            required
            className="rounded-lg border border-line/50 bg-surface-2/40 px-3 py-2 text-sm text-fg-primary"
          >
            <option value="">Select account…</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {linkedAccountLabel(a)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <input
              name="amount"
              type="number"
              min="1"
              step="0.01"
              placeholder="Amount (USD)"
              required
              className="w-full rounded-lg border border-line/50 bg-surface-2/40 px-3 py-2 text-sm text-fg-primary"
            />
            <button
              type="submit"
              disabled={pending || active.length === 0}
              className="whitespace-nowrap rounded-lg border border-gold-400/40 bg-gold-400/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-300 transition hover:bg-gold-400/20 disabled:opacity-50"
            >
              {pending ? "Working…" : "Transfer"}
            </button>
          </div>
        </form>

        {/* Transfer history */}
        {transfers.length > 0 ? (
          <div className="mt-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-neural-300">Recent transfers</p>
            <div className="mt-3 grid gap-2">
              {transfers.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line/30 bg-surface-2/20 px-4 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
                      {t.direction === "deposit" ? "In" : "Out"}
                    </span>
                    <span className="font-medium text-fg-primary">{fmt(t.amount_cents)}</span>
                    {t.description ? <span className="text-fg-muted">{t.description}</span> : null}
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] ${STATUS_STYLE[t.status]}`}
                  >
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
