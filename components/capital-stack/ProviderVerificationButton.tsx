'use client';

import { useState, useTransition } from 'react';
import { BadgeCheck, ExternalLink, Loader2 } from 'lucide-react';
import { initiateProviderVerification } from '@/lib/actions/raise-provider-verification';

/* ============================================================================
 * components/capital-stack/ProviderVerificationButton.tsx
 *
 * Standalone action button that triggers a third-party accreditation
 * verification inquiry (via lib/actions/raise-provider-verification.ts) for
 * a single raise_interests row.
 *
 * Props:
 *   interestId      — the raise_interests.id
 *   providerStatus  — current verification_provider_status (null if not started)
 *   providerUrl     — investor-facing URL from the provider (null if not available)
 *
 * Wired into the parent (ReservationsInbox) by the parent agent — do not edit
 * ReservationsInbox.tsx here.
 * ========================================================================= */

interface ProviderVerificationButtonProps {
  interestId: string;
  providerStatus: string | null;
  providerUrl: string | null;
}

export function ProviderVerificationButton({
  interestId,
  providerStatus,
  providerUrl
}: ProviderVerificationButtonProps) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the provider has already been engaged, show a status chip (+ optional link).
  if (providerStatus && !confirmed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-2 px-2 py-0.5 text-[11px] font-medium text-fg-3">
          <BadgeCheck size={11} strokeWidth={2.2} aria-hidden />
          Provider: {providerStatus}
        </span>
        {providerUrl ? (
          <a
            href={providerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-azure-1 hover:underline"
          >
            <ExternalLink size={11} strokeWidth={2.2} aria-hidden />
            Open verification
          </a>
        ) : null}
      </div>
    );
  }

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const res = await initiateProviderVerification(interestId);
      if (res.ok) {
        if (res.url) {
          window.open(res.url, '_blank', 'noopener');
        }
        setConfirmed(true);
      } else {
        setError(res.error);
      }
    });
  }

  if (confirmed) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-success">
        <BadgeCheck size={13} strokeWidth={2.2} aria-hidden />
        Verification started
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleStart}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-medium text-fg-3 transition hover:border-accent-line hover:text-fg-1 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 size={13} strokeWidth={2.2} className="animate-spin" aria-hidden />
        ) : (
          <BadgeCheck size={13} strokeWidth={2.2} aria-hidden />
        )}
        Start third-party verification
      </button>
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
