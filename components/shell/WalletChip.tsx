'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WalletChip — the always-visible "where am I on usage?" fuel-gauge.
 *
 * Self-resolves the org's balance from GET /api/wallet (so it reads identically
 * on every shell surface) and links to /settings/wallet for the full ledger,
 * earn loops and top-up. Goes gold when running low and danger when empty, so
 * the operator sees they can no longer run Earn / team functions before they
 * try. Renders nothing until resolved (and when no wallet exists) to avoid a
 * layout-shifting skeleton in the topbar.
 * ========================================================================= */

interface WalletSummaryView {
  balance: number;
  plan: string;
  isLow: boolean;
  isEmpty: boolean;
  configured: boolean;
}

export function WalletChip({ className }: { className?: string }) {
  const [wallet, setWallet] = useState<WalletSummaryView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/wallet')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WalletSummaryView | null) => {
        if (active) {
          setWallet(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!loaded || !wallet) return null;

  const tone = wallet.isEmpty ? 'empty' : wallet.isLow ? 'low' : 'ok';
  const toneClass =
    tone === 'empty'
      ? 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger hover:brightness-105'
      : tone === 'low'
        ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1 hover:brightness-105'
        : 'border-hairline bg-surface-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1';

  const status = tone === 'empty' ? ' — out of credits' : tone === 'low' ? ' — running low' : '';

  return (
    <Link
      href="/settings/wallet"
      aria-label={`Credit wallet: ${wallet.balance.toLocaleString()} credits${status}`}
      title={
        tone === 'empty'
          ? 'Out of credits — earn or top up to use Earn & team functions'
          : tone === 'low'
            ? 'Running low — earn or top up credits'
            : 'Credit wallet'
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition',
        toneClass,
        className
      )}
    >
      <EarnCoin size={16} />
      <span className="[font-feature-settings:'tnum']">{wallet.balance.toLocaleString()}</span>
    </Link>
  );
}
