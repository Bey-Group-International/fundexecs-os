'use client';

import Link from 'next/link';
import { Fuel, Plus, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CreditWallet } from '@/lib/queries/credit-wallet';

export interface CreditWalletGaugeProps {
  /** The wallet payload from `getCreditWallet(orgId)`. When omitted the gauge
   *  renders the same clean unconfigured stub it does for `configured: false`. */
  wallet?: CreditWallet | null;
  /** Where the top-up CTA points; defaults to `/settings#billing`. */
  topUpHref?: string;
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
  icon: LucideIcon;
}

const STUB_STATE: DerivedState = {
  balanceLabel: 'Off',
  recentCount: 0,
  fillPct: 0,
  tone: 'azure',
  toneColor: 'var(--azure-1)',
  icon: Fuel
};

function deriveState(wallet: CreditWallet | null | undefined): DerivedState {
  if (!wallet || !wallet.configured) return STUB_STATE;

  const balance = Math.max(0, wallet.balance);
  // Heuristic ceiling: 5,000 credits ≈ 100%. The real plan-aware ceiling
  // lands when Codex's plan tiers ship; the visual gauge is intentionally
  // forgiving until then.
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
          : 'var(--azure-1)';
  return {
    balanceLabel: balance.toLocaleString(),
    recentCount: wallet.recentConsumption.length,
    fillPct,
    tone,
    toneColor,
    icon: Zap
  };
}

/**
 * CreditWalletGauge — the top-nav fuel-gauge. Renders the org's AI-credit
 * balance, recent consumption count, and a one-click top-up CTA. When the
 * wallet seam is `configured: false` (the Wave-1 default until Codex ships
 * the ledger) the gauge degrades to a clean "Off" stub state — no fabricated
 * numbers, no error.
 *
 * Bound to `getCreditWallet(orgId)` — but it is a pure-prop UI component so
 * any page can pass `null` and get the same tasteful stub.
 */
export function CreditWalletGauge({
  wallet,
  topUpHref = '/settings#billing',
  className
}: CreditWalletGaugeProps) {
  const state = deriveState(wallet);
  const configured = !!wallet?.configured;
  const Icon = state.icon;

  const tooltip = configured
    ? `${state.balanceLabel} credits · ${wallet?.plan ?? 'standard'} plan${state.recentCount ? ` · ${state.recentCount} recent` : ''}`
    : 'Credit wallet not configured — fuel-gauge will activate when the ledger ships.';

  return (
    <Link
      href={topUpHref}
      title={tooltip}
      aria-label={configured ? `Credit wallet, ${state.balanceLabel} credits` : 'Credit wallet'}
      data-testid="credit-wallet-gauge"
      data-configured={configured ? 'true' : 'false'}
      className={cn(
        'group hidden items-center gap-2 rounded-[10px] border border-hairline bg-surface-1 px-2.5 py-1 transition-[background,box-shadow,transform] hover:-translate-y-[0.5px] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1 sm:inline-flex',
        className
      )}
    >
      <span
        aria-hidden
        className="relative flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline bg-bg-1"
        style={{ color: state.toneColor }}
      >
        <Icon size={13} strokeWidth={2} aria-hidden />
        {configured ? (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 inline-flex h-2 w-2 items-center justify-center rounded-full border border-bg-0"
            style={{ backgroundColor: state.toneColor }}
          />
        ) : null}
      </span>

      <div className="hidden flex-col items-start leading-none md:flex">
        <span
          className="text-[12.5px] font-semibold tabular-nums tracking-[-0.01em]"
          style={{ color: configured ? 'var(--fg-1)' : 'var(--fg-3)' }}
        >
          {state.balanceLabel}
        </span>
        <span
          aria-hidden
          className="mt-px text-[9px] font-semibold uppercase tracking-[0.11em] text-fg-5"
        >
          {configured ? `${wallet?.plan ?? 'standard'} · credits` : 'Wallet · stub'}
        </span>
      </div>

      {configured ? (
        <span
          aria-hidden
          className="hidden h-1 w-12 overflow-hidden rounded-full bg-surface-2 lg:block"
        >
          <span
            className="block h-full rounded-full transition-[width]"
            style={{ width: `${state.fillPct}%`, backgroundColor: state.toneColor }}
          />
        </span>
      ) : null}

      <span
        aria-hidden
        className="hidden h-5 w-5 items-center justify-center rounded-md border border-hairline bg-bg-1 text-fg-4 transition group-hover:text-fg-1 md:inline-flex"
      >
        <Plus size={11} strokeWidth={2.2} aria-hidden />
      </span>
    </Link>
  );
}

export default CreditWalletGauge;
