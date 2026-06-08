'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Sparkles, X } from 'lucide-react';
import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { dismissLaunchBrief } from '@/lib/actions/dashboard';
import type { BriefMove, LaunchBrief } from '@/lib/proof-of-truth/launch-brief';

/**
 * LaunchBriefCard — Earn's premium first-use welcome. Rendered once at the top
 * of the Command Center, gated server-side by the `fx-brief-seen` cookie (set
 * on dismiss) so returning members never see it.
 *
 * The brief itself is fetched client-side from `/api/earn/launch-brief` so the
 * AI latency never blocks the page render. The endpoint always returns a usable
 * brief (templated fallback when Earn is unavailable), so this card never errors
 * — it just shows a brief loading shimmer, then Earn's read + three first moves.
 */
export function LaunchBriefCard() {
  const [brief, setBrief] = useState<LaunchBrief | null>(null);
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    const controller = new AbortController();
    fetch('/api/earn/launch-brief', { method: 'POST', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; brief?: LaunchBrief } | null) => {
        if (data?.ok && data.brief) {
          queueMicrotask(() => setBrief(data.brief ?? null));
        } else {
          // No usable brief — quietly remove the card rather than show an error.
          queueMicrotask(() => setHidden(true));
        }
      })
      .catch(() => {
        queueMicrotask(() => setHidden(true));
      });
    return () => controller.abort();
  }, []);

  function dismiss() {
    setHidden(true);
    startTransition(() => {
      void dismissLaunchBrief();
    });
  }

  if (hidden) return null;

  return (
    <Card
      data-testid="launch-brief-card"
      className="relative overflow-hidden p-5"
      style={{
        background:
          'radial-gradient(80% 140% at 0% 0%, rgba(247,201,72,0.10), transparent 58%), radial-gradient(70% 120% at 100% 0%, rgba(91,141,239,0.06), transparent 62%)'
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss your launch brief"
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
      >
        <X size={15} strokeWidth={2} aria-hidden />
      </button>

      <div className="flex items-start gap-3">
        <EarnCoin size={40} glow online className="mt-0.5 flex-none" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-1">
            <Sparkles
              size={12}
              strokeWidth={2.2}
              className="mr-1 inline align-[-1px]"
              aria-hidden
            />
            Your launch brief from Earn
          </p>
          {brief ? (
            <p className="mt-1 max-w-[68ch] text-[14px] font-medium leading-relaxed tracking-[-0.01em] text-fg-1">
              {brief.headline}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5" aria-hidden>
              <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
            </div>
          )}
        </div>
      </div>

      {brief ? (
        <ol className="mt-4 flex flex-col gap-2">
          {brief.moves.map((move, idx) => (
            <MoveRow key={`${move.href}-${idx}`} move={move} index={idx} />
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

function MoveRow({ move, index }: { move: BriefMove; index: number }) {
  return (
    <li>
      <Link
        href={move.href}
        className="group flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
      >
        <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md border border-[var(--gold-line)] bg-[var(--gold-soft)] text-[10px] font-semibold tabular-nums text-gold-1">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-fg-1">{move.label}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-3">{move.detail}</p>
        </div>
        <ArrowUpRight
          size={13}
          strokeWidth={2}
          className="mt-1 flex-none text-azure-1 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </li>
  );
}

export default LaunchBriefCard;
