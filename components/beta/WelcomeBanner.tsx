'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const DISMISS_KEY = 'fx-welcome-dismissed-v1';

/**
 * First-run private-beta welcome shown at the top of the landing page.
 * Dismissible; the choice persists in localStorage so it shows once per
 * browser. Renders nothing until mount (and when dismissed) so it has zero
 * layout footprint otherwise. The show is deferred via queueMicrotask to
 * satisfy react-hooks/set-state-in-effect.
 */
export function WelcomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(DISMISS_KEY)) return;
    queueMicrotask(() => setVisible(true));
  }, []);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pt-24 sm:px-8">
      <div className="flex items-start gap-3 rounded-2xl border border-[var(--gold-line,var(--border))] bg-[var(--gold-soft,var(--surface-2))] p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-fg-1">Welcome to FundExecs OS 👋</p>
          <p className="mt-1 text-[12.5px] leading-6 text-fg-3">
            You&rsquo;re part of our private beta. Start with your{' '}
            <a href="/onboarding" className="font-medium text-azure-1 hover:underline">
              Proof of Truth
            </a>{' '}
            — Earn will ask a few quick questions to set up your desk and route work to the right
            specialist. Connect your tools anytime from{' '}
            <a href="/integrations" className="font-medium text-azure-1 hover:underline">
              Integrations
            </a>
            . Spot something rough? Tell Earn — you&rsquo;re helping shape the product.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss welcome message"
          className="flex-none rounded-lg p-1 text-fg-4 transition hover:bg-surface-3 hover:text-fg-2"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
