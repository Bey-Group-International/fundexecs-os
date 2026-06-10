import type { Metadata } from 'next';
import Link from 'next/link';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { RequestAccessForm } from '@/components/landing/RequestAccessForm';

/**
 * /request-access — standalone, linkable home for the request-access form.
 *
 * The landing CTAs open the same form in a modal (RequestAccessModal); this
 * route exists so outbound campaigns/emails have a shareable URL and so the
 * flow works without the modal. noindex mirrors the /login convention for
 * gated pages (app/login/layout.tsx).
 */
export const metadata: Metadata = {
  title: 'Request Access',
  description:
    'Request access to FundExecs OS — an invite-only AI executive team for private market operators. We onboard in small cohorts.',
  robots: { index: false, follow: false }
};

export default function RequestAccessPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg-0 text-fg-1">
      <header className="border-b border-hairline">
        <nav
          className="mx-auto flex h-[60px] max-w-[1180px] items-center justify-between px-5 sm:px-8"
          aria-label="Primary"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            aria-label="FundExecs OS home"
          >
            <EarnCoin size={26} />
            <span className="text-base font-semibold tracking-[-0.02em] text-fg-1">
              FundExecs <span className="font-medium text-fg-4">OS</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-md text-sm font-medium text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg-1 sm:text-3xl">
              Request access
            </h1>
            <p className="mt-3 text-[14px] leading-6 text-fg-3">
              FundExecs OS is invite-only. Tell us about your desk and we&rsquo;ll be in touch when
              your cohort opens.
            </p>
          </div>
          <div className="rounded-2xl border border-hairline bg-bg-1 p-5 shadow-[var(--shadow-lg)] sm:p-6">
            <RequestAccessForm source="request-access-page" />
          </div>
        </div>
      </main>
    </div>
  );
}
