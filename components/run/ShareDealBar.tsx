"use client";

// components/run/ShareDealBar.tsx
// The "share this deal across the ecosystem" control on a deal war room. One
// click has Earn draft a confidential teaser memo, broadcast it to matched
// discoverable investors (their bell + "deals that fit you" feed), and mint a
// tracked public link you can send to anyone directly. Shows the memo and a
// copyable link once shared.
import Link from "next/link";
import { useState, useTransition } from "react";
import { shareDealAction } from "@/app/(app)/deal/[id]/actions";

interface ShareState {
  url: string;
  memo: string;
  matched: number;
  fits: number;
}

export function ShareDealBar({ dealId }: { dealId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ShareState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function share() {
    setError(null);
    startTransition(async () => {
      const res = await shareDealAction(dealId);
      if (res.ok) {
        setResult({
          url: `${window.location.origin}${res.path}`,
          memo: res.memo,
          matched: res.matched,
          fits: res.fits,
        });
      } else {
        setError(res.error);
      }
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — the link is selectable in the field as a fallback
    }
  }

  return (
    <div className="fx-card mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">Share across the ecosystem</p>
          <p className="mt-1 max-w-prose text-xs leading-snug text-fg-secondary">
            Earn drafts a confidential teaser, alerts matching discoverable investors, and mints a
            tracked link you can send directly. The full deal room stays gated.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/deal/${dealId}/room`}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            Investor Room
          </Link>
          <button
            type="button"
            onClick={share}
            disabled={pending}
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-60"
          >
            {pending ? "Sharing…" : result ? "Re-share" : "Share deal"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-status-danger">{error}</p> : null}

      {result ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
            {result.matched > 0
              ? `Alerted ${result.matched} matching firm${result.matched === 1 ? "" : "s"}`
              : "No ecosystem matches yet — your link is live"}
            {result.fits > result.matched ? ` · ${result.fits} fitting investors` : ""}
          </p>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              Earn&apos;s teaser memo
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-secondary">{result.memo}</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              readOnly
              value={result.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-fg-secondary"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
