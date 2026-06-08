import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, TrendingUp, Users, Target } from 'lucide-react';
import { getPublicRaise } from '@/lib/queries/public-raise';
import { RaiseInterestForm } from '@/components/raise/RaiseInterestForm';
import { RaiseReserveForm } from '@/components/raise/RaiseReserveForm';

export const dynamic = 'force-dynamic';

/**
 * Public, token-gated raise / campaign page (/r/<token>).
 *
 * Server-rendered via the service-role admin client (see getPublicRaise), which
 * validates the share token and returns ONLY the safe subset. No AppShell and
 * no auth — a clean, bright, read-only public surface. The whole page is wrapped
 * in `.fx-theme-light` so it reads as a marketplace page while the authenticated
 * app stays dark. Kept `noindex` (like /p/<token>) so links are shareable but
 * not crawled.
 */

export async function generateMetadata({
  params
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const raise = await getPublicRaise(token);
  if (!raise) return { title: 'Raise unavailable · FundExecs', robots: { index: false } };
  const name = raise.title ?? raise.entityName;
  return {
    title: `${name} · Raise · FundExecs`,
    description: raise.headline ?? `${raise.entityName} is raising on FundExecs.`,
    robots: { index: false }
  };
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export default async function PublicRaisePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raise = await getPublicRaise(token);

  if (!raise) {
    return (
      <main className="fx-theme-light flex min-h-screen items-center justify-center bg-bg-0 px-6">
        <div className="w-full max-w-md rounded-2xl border border-hairline bg-bg-1 p-8 text-center shadow-[var(--shadow-lg)]">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-4">
            Link unavailable
          </p>
          <h1 className="mt-2 text-[18px] font-semibold tracking-[-0.015em] text-fg-1">
            This raise link isn&rsquo;t active
          </h1>
          <p className="mt-2 text-[13px] text-fg-3">
            It may have been unpublished or expired. Ask whoever shared it for a fresh link.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-xl bg-accent px-4 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-md)] transition hover:bg-accent-2"
          >
            Explore FundExecs
          </Link>
        </div>
      </main>
    );
  }

  const heading = raise.title ?? raise.entityName;
  const committedPct = Math.max(0, Math.min(100, raise.committedPct));
  const coveragePct = Math.max(0, Math.min(100, raise.coveragePct));
  const softPct = Math.max(0, coveragePct - committedPct);
  // 506(b) = private placement (no general solicitation): gate the CTA.
  const gated = raise.exemption === '506b';
  // 506(c) = general solicitation permitted; attestation required.
  const is506c = raise.exemption === '506c';
  // Show the reserve CTA only when the owner enabled it and it's a 506(c) raise.
  const showReserve = is506c && raise.acceptReservations;

  return (
    <main className="fx-theme-light min-h-screen bg-bg-0 px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        {/* Wordmark */}
        <div className="mb-5 flex items-center justify-between">
          <div className="text-[15px] font-semibold tracking-[-0.02em] text-fg-1">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-2">
            <ShieldCheck size={11} strokeWidth={2} aria-hidden />
            {raise.trustPct}% chain of trust
          </span>
        </div>

        <article className="overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)]">
          {/* Header */}
          <header className="relative px-6 py-7">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  'radial-gradient(70% 130% at 0% 0%, rgba(37,99,235,0.08), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(247,201,72,0.08), transparent 65%)'
              }}
            />
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-accent">
              {gated ? 'Private placement' : 'Open raise'} · {raise.memberLabel}
              {raise.exemption ? (
                <span className="text-fg-4">
                  {' '}
                  · Reg D {raise.exemption === '506b' ? '506(b)' : '506(c)'}
                </span>
              ) : null}
            </p>
            <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em] text-fg-1 sm:text-[30px]">
              {heading}
            </h1>
            <p className="mt-0.5 text-[13px] text-fg-3">
              {raise.entityName}
              {raise.ownerName ? ` · ${raise.ownerName}` : ''}
            </p>
            {raise.headline ? (
              <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-fg-2">
                {raise.headline}
              </p>
            ) : null}
          </header>

          {/* Momentum */}
          <section className="border-t border-hairline px-6 py-6">
            <div className="mb-2 flex items-end justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                Raise progress
              </p>
              <p className="text-[12px] font-semibold text-fg-2">{coveragePct}% of target</p>
            </div>
            {/* Progress bar: committed (solid accent) + soft-circled (lighter). */}
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuenow={coveragePct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Raise coverage"
            >
              <div className="flex h-full">
                <div className="h-full bg-accent" style={{ width: `${committedPct}%` }} />
                <div className="h-full bg-accent/40" style={{ width: `${softPct}%` }} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat
                icon="trend"
                label="Committed"
                value={
                  raise.showAmounts && raise.committed != null
                    ? money(raise.committed)
                    : `${committedPct}%`
                }
              />
              <Stat
                icon="target"
                label={raise.showAmounts && raise.target != null ? 'Target' : 'Coverage'}
                value={
                  raise.showAmounts && raise.target != null
                    ? money(raise.target)
                    : `${coveragePct}%`
                }
              />
              <Stat icon="users" label="Interested" value={String(raise.interestCount)} />
            </div>

            {raise.minCheck ? (
              <p className="mt-4 text-[12px] text-fg-3">
                Minimum check{' '}
                <span className="font-semibold text-fg-1">{money(raise.minCheck)}</span>
              </p>
            ) : null}
          </section>

          {/* Express interest / request access (gated under 506(b)) */}
          <section className="border-t border-hairline bg-surface-1/50 px-6 py-6">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg-1">
              {gated ? 'Request access' : 'Express interest'}
            </h2>
            <p className="mt-1 mb-4 max-w-[56ch] text-[13px] text-fg-3">
              {gated
                ? 'This is a private placement (Reg D 506(b)). Request access and the team will follow up directly if you qualify. This is not a commitment to invest.'
                : 'Share your details and the team will follow up directly. This is not a commitment to invest.'}
            </p>
            <RaiseInterestForm
              token={token}
              minCheck={raise.minCheck}
              gated={gated}
              requires506cAttestation={is506c}
            />
          </section>

          {/* Reservation section — only shown when the owner enabled it (506(c)) */}
          {showReserve ? (
            <section className="border-t border-hairline bg-surface-1/50 px-6 py-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg-1">
                    Reserve your allocation
                  </h2>
                  <p className="mt-1 max-w-[56ch] text-[13px] text-fg-3">
                    Secure your spot with a reservation deposit via Stripe. Accredited investors
                    only (Reg D 506(c)). This is not a final investment commitment.
                  </p>
                </div>
              </div>
              <RaiseReserveForm token={token} minCheck={raise.minCheck} />
            </section>
          ) : null}

          {/* Footer */}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4">
            <p className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-4">
              <ShieldCheck size={13} strokeWidth={2} aria-hidden />
              Progress verified by FundExecs Chain of Trust.
            </p>
            <Link
              href="/"
              className="inline-flex rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-[var(--shadow-md)] transition hover:bg-accent-2"
            >
              Raise on FundExecs
            </Link>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Stat({
  icon,
  label,
  value
}: {
  icon: 'trend' | 'target' | 'users';
  label: string;
  value: string;
}) {
  const Icon = icon === 'trend' ? TrendingUp : icon === 'target' ? Target : Users;
  return (
    <div className="rounded-xl border border-hairline bg-bg-2 px-3 py-3">
      <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">
        <Icon size={12} strokeWidth={2} aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-[18px] font-semibold tracking-[-0.01em] text-fg-1">{value}</p>
    </div>
  );
}
