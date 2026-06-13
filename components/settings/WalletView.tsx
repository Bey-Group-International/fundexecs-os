'use client';

import { useState, useTransition } from 'react';
import { ArrowUpRight, Loader2, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import {
  createBillingPortalSession,
  createCustomTopUpCheckout
} from '@/lib/actions/stripe-checkout';
import { CUSTOM_CREDIT_DOLLARS, type CreditPackDollars } from '@/lib/billing/credit-packs';
import { reasonLabel } from '@/lib/credits/labels';
import { openEarn } from '@/lib/earn/launcher';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WalletView — the /settings/wallet surface: balance, this-month usage, the
 * full credit ledger, and the three paths when you want more (earn, top up,
 * upgrade). Read-side data is resolved server-side and passed in; the top-up
 * and plan actions are the existing Stripe server actions, which degrade to a
 * graceful "billing not enabled" message on deployments without keys.
 * ========================================================================= */

export interface LedgerEntry {
  id: string;
  reason: string;
  /** Negative = spend, positive = earn / top-up / grant. */
  delta: number;
  at: string;
}

export interface WalletViewProps {
  balance: number;
  plan: string;
  monthlyGrant: number;
  usedThisMonth: number;
  isLow: boolean;
  isEmpty: boolean;
  ledger: LedgerEntry[];
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

function planName(plan: string): string {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Free';
}

export function WalletView({
  balance,
  plan,
  monthlyGrant,
  usedThisMonth,
  isLow,
  isEmpty,
  ledger
}: WalletViewProps) {
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  function runCheckout(
    key: string,
    action: () => Promise<{ ok: boolean; url?: string; error?: string }>
  ) {
    setBusyAction(key);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok && result.url) {
        window.location.href = result.url;
        return;
      }
      setBusyAction(null);
      setMessage({
        tone: 'error',
        text: result.error ?? 'Something went wrong. Please try again.'
      });
    });
  }

  const grantPct =
    monthlyGrant > 0 ? Math.min(100, Math.round((usedThisMonth / monthlyGrant) * 100)) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Wallet</h1>
        <p className="mt-1 text-[13px] text-fg-4">
          Manual tools are always free. Earn and your team functions run on credits — here&apos;s
          where you stand.
        </p>
      </div>

      {/* ── balance + usage headline ─────────────────────────────────── */}
      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <EarnCoin size={40} glow />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Balance
              </div>
              <div
                className={cn(
                  "text-[30px] font-semibold leading-tight [font-feature-settings:'tnum']",
                  isEmpty ? 'text-danger' : isLow ? 'text-gold-1' : 'text-fg-1'
                )}
              >
                {balance.toLocaleString()}
                <span className="ml-1 text-[14px] font-medium text-fg-4">credits</span>
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-3 py-1 text-[12.5px] font-semibold text-fg-2">
            <Wallet size={14} aria-hidden />
            {planName(plan)} plan
          </span>
        </div>

        {(isLow || isEmpty) && (
          <div
            className={cn(
              'rounded-xl border px-3.5 py-2.5 text-[12.5px]',
              isEmpty
                ? 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
                : 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
            )}
          >
            {isEmpty
              ? 'You’re out of credits. Earn or top up to keep using Earn and your team functions — manual tools keep working.'
              : 'Running low — you may not be able to run heavier actions. Earn or top up to stay ahead.'}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12px] text-fg-4">
            <span>Used this month</span>
            <span className="[font-feature-settings:'tnum']">
              {usedThisMonth.toLocaleString()} / {monthlyGrant.toLocaleString()} grant
            </span>
          </div>
          <ProgressBar value={grantPct} height={5} tone={isLow || isEmpty ? 'gold' : 'accent'} />
        </div>

        {/* ── the three paths to more credits ──────────────────────────── */}
        <div className="flex flex-wrap gap-2.5">
          <Button variant="gold" icon={Sparkles} onClick={() => openEarn()}>
            Earn credits
          </Button>
          <Button
            variant="primary"
            icon={pending && busyAction === 'topup' ? Loader2 : ArrowUpRight}
            disabled={pending}
            onClick={() => runCheckout('topup', () => createCustomTopUpCheckout(DEFAULT_PACK))}
          >
            Top up
          </Button>
          <Button
            variant="outline"
            icon={pending && busyAction === 'upgrade' ? Loader2 : TrendingUp}
            disabled={pending}
            onClick={() => runCheckout('upgrade', () => createBillingPortalSession())}
          >
            Upgrade plan
          </Button>
        </div>

        {message && (
          <p className={cn('text-[12px]', message.tone === 'error' ? 'text-danger' : 'text-fg-4')}>
            {message.text}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {CUSTOM_CREDIT_DOLLARS.map((dollars) => (
            <button
              key={dollars}
              type="button"
              disabled={pending}
              onClick={() =>
                runCheckout(`pack-${dollars}`, () => createCustomTopUpCheckout(dollars))
              }
              className="rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[12px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-60"
            >
              ${dollars}
            </button>
          ))}
        </div>
      </Card>

      {/* ── ledger ───────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-3">
        <div className="text-[13.5px] font-semibold">Recent activity</div>
        {ledger.length === 0 ? (
          <p className="text-[13px] text-fg-4">
            No credit activity yet. Earn or team functions will show up here as they run.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {ledger.map((entry) => {
              const earned = entry.delta >= 0;
              return (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-fg-1">
                      {reasonLabel(entry.reason)}
                    </div>
                    <div className="text-[11px] text-fg-4">
                      {DATE_FMT.format(new Date(entry.at))}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-[13px] font-semibold [font-feature-settings:'tnum']",
                      earned ? 'text-success' : 'text-fg-3'
                    )}
                  >
                    {earned ? '+' : '−'}
                    {Math.abs(entry.delta).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Default top-up pack ($20) for the headline button; packs row covers the rest. */
const DEFAULT_PACK: CreditPackDollars = 20;
