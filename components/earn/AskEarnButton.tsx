'use client';

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { openEarn, type EarnOpenDetail } from '@/lib/earn/launcher';

/**
 * AskEarnButton — the reusable per-surface entry to Earn. Any panel can drop
 * this in to hand the operator a contextual way in; an optional `command` or
 * `ask` hands Earn a starting intent so the button does something specific
 * (e.g. a panel's "Ask Earn" that opens straight into review or analysis).
 */
export function AskEarnButton({
  label = 'Ask Earn',
  variant = 'ghost',
  size = 'sm',
  detail
}: {
  label?: string;
  variant?: 'ghost' | 'secondary' | 'gold';
  size?: 'sm' | 'md';
  detail?: EarnOpenDetail;
}) {
  return (
    <Button variant={variant} size={size} icon={Sparkles} onClick={() => openEarn(detail)}>
      {label}
    </Button>
  );
}
