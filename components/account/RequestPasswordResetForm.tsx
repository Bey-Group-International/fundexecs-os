'use client';

import { useState } from 'react';
import { Mail, ArrowRight, Check } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { requestPasswordReset } from '@/lib/actions/account-security';

/**
 * Email-entry form that triggers a password-reset link. Used on the /auth/reset
 * landing when the recovery session is absent (link expired or opened cold).
 * Always reports success — we don't reveal whether an address has an account.
 */
export function RequestPasswordResetForm({ defaultEmail = '' }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    await requestPasswordReset(email);
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] px-3.5 py-3 text-[12.5px] text-success">
        <Check size={15} strokeWidth={2} aria-hidden className="mt-0.5 flex-none" />
        <span>
          If an account exists for <span className="font-semibold">{email.trim()}</span>, a reset
          link is on its way. Open it on this device to set a new password.
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label="Email"
        type="email"
        required
        icon={Mail}
        placeholder="you@fund.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" iconRight={ArrowRight} disabled={busy}>
          {busy ? 'Sending…' : 'Email me a reset link'}
        </Button>
      </div>
    </form>
  );
}

export default RequestPasswordResetForm;
