'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Check, ShieldCheck } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { setAccountPassword } from '@/lib/actions/account-security';

const MIN_LENGTH = 8;

/**
 * Set / update the signed-in user's password — the durable key back in. Reused
 * by onboarding (the "Secure your account" step), Settings → Security, and the
 * password-reset landing. Validates match + length client-side, then calls the
 * `setAccountPassword` server action.
 */
export function SetPasswordForm({
  submitLabel = 'Set password',
  doneLabel = 'Password set — you can now sign in with email + password.',
  /** When set, navigate here on success instead of showing the inline done state. */
  redirectTo,
  onDone,
  autoFocus = false
}: {
  submitLabel?: string;
  doneLabel?: string;
  redirectTo?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setAccountPassword(password);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    onDone?.();
    if (redirectTo) router.push(redirectTo);
  }

  if (done && !redirectTo) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] px-3.5 py-3 text-[12.5px] font-medium text-success">
        <Check size={15} strokeWidth={2} aria-hidden />
        {doneLabel}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label="New password"
        type="password"
        icon={Lock}
        autoComplete="new-password"
        autoFocus={autoFocus}
        minLength={MIN_LENGTH}
        placeholder="At least 8 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Input
        label="Confirm password"
        type="password"
        icon={Lock}
        autoComplete="new-password"
        placeholder="Re-enter your password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {error && (
        <p className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" icon={ShieldCheck} disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default SetPasswordForm;
