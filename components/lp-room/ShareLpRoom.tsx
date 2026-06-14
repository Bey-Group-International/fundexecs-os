'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, Link2, Loader2, Share2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { LINK_EXPIRY_PRESETS, DEFAULT_LINK_EXPIRY } from '@/lib/dataroom/config';
import { generateLpRoomLink } from '@/lib/lp-room/link-actions';
import type { LpRoomTier } from '@/lib/lp-room/public';

/**
 * ShareLpRoom — the manager-side affordance that mints an external, tokenized
 * LP-room link for a chosen access tier and surfaces the shareable URL. Mirrors
 * the Data Room's link-generation UX; the heavy lifting (token, persistence,
 * tier encoding) lives in the server action `generateLpRoomLink`.
 */

const TIERS: { id: LpRoomTier; label: string; blurb: string }[] = [
  { id: 'prospect', label: 'Prospect', blurb: 'Sees prospect documents only.' },
  {
    id: 'committed',
    label: 'Committed LP',
    blurb: 'Sees prospect + committed documents.'
  }
];

export function ShareLpRoom() {
  const [tier, setTier] = useState<LpRoomTier>('prospect');
  const [expiry, setExpiry] = useState<string>(DEFAULT_LINK_EXPIRY);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function mint() {
    setError(null);
    setUrl(null);
    setCopied(false);
    start(async () => {
      try {
        const res = await generateLpRoomLink(tier, expiry);
        if (res.ok) {
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          setUrl(`${origin}/lp/${res.token}`);
        } else {
          setError(res.error);
        }
      } catch {
        setError('Could not generate link — try again.');
      }
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const tierMeta = TIERS.find((t) => t.id === tier)!;

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <Share2 size={14} strokeWidth={1.9} aria-hidden />
        Share the LP Room
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-3">
        Mint a read-only link for an external LP. The link decides what they see — never admin-only
        documents, and never another LP&rsquo;s commitment schedule.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Access tier"
          hint={tierMeta.blurb}
          value={tier}
          onChange={(e) => setTier(e.target.value as LpRoomTier)}
          options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
        />
        <Select
          label="Expiry"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          options={LINK_EXPIRY_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          <TriangleAlert size={15} aria-hidden />
          {error}
        </div>
      )}
      {url ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
            <Link2 size={15} className="flex-none text-fg-4" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{url}</span>
            <Badge tone="gold" className="flex-none">
              {tierMeta.label}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            icon={copied ? Check : Copy}
            onClick={copy}
            className="self-start"
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      ) : (
        <Button
          icon={pending ? Loader2 : Link2}
          disabled={pending}
          onClick={mint}
          className="self-start"
        >
          {pending ? 'Minting…' : 'Generate link'}
        </Button>
      )}
    </Card>
  );
}
