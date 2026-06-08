'use client';

import { useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { Button } from '@/components/ui';

/** Copy / email the redeem link so the buyer can share it even if email didn't send. */
export function GiftSuccessActions({
  redeemUrl,
  recipientEmail
}: {
  redeemUrl: string;
  recipientEmail: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(redeemUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — leave UI unchanged.
    }
  }

  const mailto = `mailto:${encodeURIComponent(recipientEmail ?? '')}?subject=${encodeURIComponent(
    'A FundExecs gift for you'
  )}&body=${encodeURIComponent(`Redeem your FundExecs credits here: ${redeemUrl}`)}`;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="light" icon={copied ? Check : Copy} onClick={copy}>
        {copied ? 'Copied' : 'Copy redeem link'}
      </Button>
      <Button variant="secondary" icon={Mail} onClick={() => window.location.assign(mailto)}>
        Email the link
      </Button>
    </div>
  );
}

export default GiftSuccessActions;
