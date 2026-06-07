'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EarnCoin } from '@/components/screens/EarnCoin';
import type { CreditWallet } from '@/lib/queries/credit-wallet';
import { WalletTopUpPopover } from './WalletTopUpPopover';

export interface CreditWalletGaugeProps {
  /** The wallet payload from `getCreditWallet(orgId)`.
   *  - A `CreditWallet` (or explicit `null`) is treated as authoritative.
   *  - `undefined` (the page didn't resolve a wallet) triggers a one-shot
   *    self-fetch from `/api/wallet`, so the module reads identically on every
   *    screen rather than showing a balance on some and the stub on others. */
  wallet?: CreditWallet | null;
  className?: string;
}

interface DerivedState {
  balanceLabel: string;
  recentCount: number;
  /** 0–100 visual fill against a heuristic ceiling — purely decorative. */
  fillPct: number;
  /** Tone of the gauge — degrades as balance approaches zero. */
  tone: 'success' | 'azure' | 'warning' | 'danger';
  toneColor: string;
}

const STUB_STATE: DerivedState = {
  balanceLabel: '—',
  recentCount: 0,
  fillPct: 0,
  tone: 'azure',
  toneColor: 'var(--gold-1)'
};

function deriveState(wallet: CreditWallet | null | undefined): DerivedState {
  if (!wallet || !wallet.configured) return STUB_STATE;

  const balance = Math.max(0, wallet.balance);
  // Heuristic ceiling: 5,000 Earn coins ≈ 100%. The real plan-aware ceiling
  // lands when plan tiers ship; the visual gauge is intentionally forgiving.
  const fillPct = Math.min(100, Math.round((balance / 5000) * 100));
  const tone: DerivedState['tone'] =
    balance >= 1500 ? 'success' : balance >= 500 ? 'azure' : balance >= 100 ? 'warning' : 'danger';
  const toneColor =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--gold-1)';
  return {
    balanceLabel: balance.toLocaleString(),
    recentCount: wallet.recentConsumption.length,
    fillPct,
    tone,
    toneColor
  };
}

/**
 * CreditWalletGauge — the top-nav **Earn coins** wallet (Earn coins are the
 * platform's AI credits; spending them runs Earn and the 15-agent desk). One
 * proprietary module: the gold Earn coin mark, the balance labelled "Earn
 * coins", a tone bar that degrades toward empty, and a top-up affordance. The
 * old separate gamification "Earn coins" pill is gone — XP/level lives in the
 * dashboard and side-rail, so the nav has a single, unambiguous wallet.
 *
 * Clicking opens `WalletTopUpPopover` (balance · recent usage · Stripe top-up).
 * When the wallet seam is `configured: false` it degrades to a clean stub — no
 * fabricated numbers. When no wallet is passed, it self-fetches `/api/wallet`
 * so the balance is consistent on every screen.
 */
export function CreditWalletGauge({ wallet: walletProp, className }: CreditWalletGaugeProps) {
  // `undefined` prop → self-fetch; an explicit value (including null) is used
  // as-is so callers that already resolved the wallet stay authoritative.
  const [fetched, setFetched] = useState<CreditWallet | null | undefined>(undefined);
  const wallet = walletProp !== undefined ? walletProp : fetched;

  useEffect(() => {
    if (walletProp !== undefined) return;
    let active = true;
    fetch('/api/wallet', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CreditWallet | null) => {
        if (active) setFetched(data);
      })
      .catch(() => {
        if (active) setFetched(null);
      });
    return () => {
      active = false;
    };
  }, [walletProp]);

  const state = deriveState(wallet);
  const configured = !!wallet?.configured;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const tooltip = configured
    ? `${state.balanceLabel} Earn coins · ${wallet?.plan ?? 'standard'} plan${state.recentCount ? ` · ${state.recentCount} recent` : ''} — click to top up`
    : 'Earn coins — your AI credits. Click to top up.';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        title={tooltip}
        aria-label={
          configured ? `Earn coins wallet, ${state.balanceLabel} coins` : 'Earn coins wallet'
        }
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        data-testid="credit-wallet-gauge"
        data-configured={configured ? 'true' : 'false'}
        className={cn(
          'group hidden items-center gap-2 rounded-[10px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-1 transition-[background,box-shadow,transform] hover:-translate-y-[0.5px] hover:brightness-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1 sm:inline-flex',
          popoverOpen && 'brightness-[1.03]',
          className
        )}
      >
        <EarnCoin size={22} />

        <div className="hidden flex-col items-start leading-none md:flex">
          <span className="text-[12.5px] font-semibold tabular-nums tracking-[-0.01em] text-gold-1">
            {state.balanceLabel}
          </span>
          <span
            aria-hidden
            className="mt-px text-[8px] font-semibold uppercase tracking-[0.11em] text-gold-1/75"
          >
            Earn coins
          </span>
        </div>

        {configured ? (
          <span
            aria-hidden
            className="hidden h-1 w-12 overflow-hidden rounded-full bg-[var(--gold-line)] lg:block"
          >
            <span
              className="block h-full rounded-full transition-[width]"
              style={{ width: `${state.fillPct}%`, backgroundColor: state.toneColor }}
            />
          </span>
        ) : null}

        <span
          aria-hidden
          className="hidden h-5 w-5 items-center justify-center rounded-md border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1 transition group-hover:brightness-110 md:inline-flex"
        >
          <Plus size={11} strokeWidth={2.2} aria-hidden />
        </span>
      </button>

      {/* Top-up popover */}
      <WalletTopUpPopover
        wallet={wallet ?? null}
        anchorRef={buttonRef}
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
      />
    </div>
  );
}

export default CreditWalletGauge;
