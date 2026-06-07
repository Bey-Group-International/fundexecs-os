'use client';

import { useRef, useState, useEffect, useTransition } from 'react';
import { Zap, Plus, X, ExternalLink, TestTube2, Fuel, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createTopUpCheckout } from '@/lib/actions/stripe-checkout';
import { TOPUP_TIERS, type TopUpTier } from '@/lib/billing/topup-tiers';
import type { CreditWallet } from '@/lib/queries/credit-wallet';

/* ============================================================================
 * WalletTopUpPopover — Stripe credit top-up control in the wallet popover.
 *
 * Renders a floating popover anchored to the CreditWalletGauge button. Shows:
 *   - Current balance + plan
 *   - Recent consumption list (last 5)
 *   - Three top-up tier buttons → calls `createTopUpCheckout` → redirects
 *   - Test-mode badge when NEXT_PUBLIC_STRIPE_TEST_MODE is set
 *   - Placeholder state when Stripe is not yet wired
 *
 * Design: solid bg-bg-1, tokens-only, no fabricated numbers.
 * ========================================================================= */

const IS_TEST_MODE = process.env.NEXT_PUBLIC_STRIPE_TEST_MODE === 'true';

function formatDelta(delta: number): string {
  return delta >= 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
}

function humanizeReason(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface WalletTopUpPopoverProps {
  wallet: CreditWallet | null;
  /** Anchor element ref — popover positions relative to this. */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

export function WalletTopUpPopover({ wallet, anchorRef, open, onClose }: WalletTopUpPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedTier, setSelectedTier] = useState<TopUpTier | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const configured = wallet?.configured ?? false;
  const balance = wallet?.balance ?? 0;

  function handleTopUp(credits: TopUpTier) {
    setSelectedTier(credits);
    setError(null);
    startTransition(async () => {
      const result = await createTopUpCheckout(credits);
      if (result.ok && result.url) {
        window.location.assign(result.url);
      } else {
        setError(result.error ?? 'Top-up failed. Please try again.');
        setSelectedTier(null);
      }
    });
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Credit wallet"
      className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)] animate-in fade-in slide-in-from-top-1 duration-100"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-surface-1 text-azure-1">
            <Zap size={13} strokeWidth={2} aria-hidden />
          </span>
          <span className="text-[13px] font-semibold text-fg-1">Credit Wallet</span>
          {IS_TEST_MODE ? (
            <span className="flex items-center gap-1 rounded-md border border-[var(--warning-line)] bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-warning">
              <TestTube2 size={10} strokeWidth={2} aria-hidden />
              Test
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close wallet"
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <X size={13} strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      {/* Balance */}
      <div className="px-4 py-3">
        {configured ? (
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Balance
              </p>
              <p className="mt-0.5 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                {balance.toLocaleString()}
                <span className="ml-1 text-[13px] font-normal text-fg-4">credits</span>
              </p>
            </div>
            <span className="rounded-lg border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-3">
              {wallet?.plan ?? 'standard'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
            <Fuel size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
            <p className="text-[12.5px] text-fg-3">
              Wallet not configured — credits activate when the ledger ships.
            </p>
          </div>
        )}
      </div>

      {/* Recent consumption */}
      {configured && wallet && wallet.recentConsumption.length > 0 ? (
        <div className="border-t border-hairline px-4 py-2">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Recent
          </p>
          <ul className="space-y-1">
            {wallet.recentConsumption.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] text-fg-3">{humanizeReason(c.reason)}</span>
                <span
                  className={cn(
                    'flex-none text-[12px] tabular-nums font-medium',
                    c.delta >= 0 ? 'text-success' : 'text-fg-3'
                  )}
                >
                  {formatDelta(c.delta)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Top-up tiers */}
      <div className="border-t border-hairline px-4 py-3">
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Top Up
        </p>
        <div className="space-y-1.5">
          {TOPUP_TIERS.map((tier) => {
            const isSelected = selectedTier === tier.credits;
            return (
              <button
                key={tier.credits}
                type="button"
                disabled={pending}
                onClick={() => handleTopUp(tier.credits as TopUpTier)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition',
                  isSelected
                    ? 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
                    : 'border-hairline bg-surface-1 hover:bg-surface-2',
                  pending && !isSelected && 'opacity-50'
                )}
              >
                <div>
                  <span className="text-[13px] font-medium text-fg-1">{tier.label}</span>
                  <span className="ml-2 text-[11.5px] text-fg-4">{tier.priceLabel}</span>
                </div>
                {isSelected && pending ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-azure-1 border-t-transparent" />
                ) : (
                  <ChevronRight size={13} strokeWidth={1.9} className="text-fg-4" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="mt-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        ) : null}

        {IS_TEST_MODE ? (
          <p className="mt-2 text-center text-[11px] text-fg-5">
            Test mode — no real charges will be made
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div className="border-t border-hairline px-4 py-2.5">
        <a
          href="/settings#billing"
          className="flex items-center gap-1 text-[12px] text-fg-4 transition hover:text-fg-1"
        >
          <ExternalLink size={12} strokeWidth={1.9} aria-hidden />
          Billing settings
        </a>
      </div>
    </div>
  );
}
