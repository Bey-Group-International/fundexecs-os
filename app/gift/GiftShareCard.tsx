'use client';

import { useState } from 'react';
import { Check, Copy, Mail, Share2 } from 'lucide-react';
import { Button } from '@/components/ui';

const REFERRAL_URL = 'https://fundexecs.com/?ref=desk';

const SHARE_MESSAGE = `I run my fund on FundExecs OS — the operating desk for emerging managers. It pairs a Chain of Trust with 15 specialized agents so the back office mostly runs itself. Thought you'd want a look: ${REFERRAL_URL}`;

/**
 * Real, working share surface: copy the referral link, copy a ready-to-send
 * message, or open an email draft. Uses the Web Share API when available
 * (mobile), falling back to clipboard. Not a dead stub.
 */
export function GiftShareCard() {
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);

  async function copy(text: string, which: 'link' | 'message') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800);
    } catch {
      // Clipboard blocked (e.g. insecure context) — leave UI unchanged.
    }
  }

  async function nativeShare() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: 'FundExecs OS',
          text: SHARE_MESSAGE,
          url: REFERRAL_URL
        });
        return;
      } catch (error) {
        // User intentionally cancelled the native share — don't overwrite the
        // clipboard. Only fall through to copy on a real share failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copy(SHARE_MESSAGE, 'message');
  }

  const mailto = `mailto:?subject=${encodeURIComponent(
    'You should run your fund on FundExecs OS'
  )}&body=${encodeURIComponent(SHARE_MESSAGE)}`;

  return (
    <div className="space-y-4">
      {/* Referral link */}
      <div className="rounded-2xl border border-hairline bg-surface-1 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          Your invite link
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-bg-1 px-3 py-2 font-mono text-[12.5px] text-fg-2">
            {REFERRAL_URL}
          </code>
          <Button
            variant="light"
            icon={copied === 'link' ? Check : Copy}
            onClick={() => copy(REFERRAL_URL, 'link')}
            className="flex-none"
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>

      {/* Ready-to-send message */}
      <div className="rounded-2xl border border-hairline bg-surface-1 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          Ready-to-send message
        </p>
        <p className="mt-2 rounded-lg border border-hairline bg-bg-1 px-3 py-2.5 text-[13px] leading-6 text-fg-2">
          {SHARE_MESSAGE}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" icon={Share2} onClick={nativeShare}>
            Share
          </Button>
          <Button
            variant="secondary"
            icon={copied === 'message' ? Check : Copy}
            onClick={() => copy(SHARE_MESSAGE, 'message')}
          >
            {copied === 'message' ? 'Copied' : 'Copy message'}
          </Button>
          <Button variant="ghost" icon={Mail} onClick={() => window.location.assign(mailto)}>
            Email it
          </Button>
        </div>
      </div>
    </div>
  );
}

export default GiftShareCard;
