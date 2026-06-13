import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicRaise } from '@/lib/public/actions';
import { InterestForm } from './InterestForm';
import { RaiseProgress } from './RaiseProgress';

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const raise = await getPublicRaise(slug);
  if (!raise) return { title: 'Raise Not Found · FundExecs OS' };
  return {
    title: `${raise.name} · FundExecs OS`,
    description: raise.raise_summary ?? `${raise.name} is raising on FundExecs OS.`
  };
}

export default async function RaisePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const raise = await getPublicRaise(slug);
  if (!raise) notFound();

  const now = Date.now();

  const pct =
    raise.target_amount && raise.committed_amount
      ? Math.min(100, Math.round((raise.committed_amount / raise.target_amount) * 100))
      : 0;

  const daysLeft = raise.close_date
    ? Math.max(0, Math.ceil((new Date(raise.close_date).getTime() - now) / 86_400_000))
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.07] border border-white/[0.08] text-lg font-bold text-white">
            {raise.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{raise.name}</h1>
            {raise.company_website && (
              <a
                href={raise.company_website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[#5b8def] hover:underline"
              >
                {raise.company_website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* Stage badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.055] px-3 py-1 text-[11.5px] font-medium text-[#94a3b8] capitalize">
          {raise.stage?.replace('-', ' ')}
        </span>
      </div>

      {/* Raise stats */}
      <div className="mb-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
        <div className="grid grid-cols-3 gap-6 mb-5">
          <Stat
            label="Raise target"
            value={raise.target_amount ? `$${formatAmount(raise.target_amount)}` : '—'}
          />
          <Stat
            label="Committed"
            value={raise.committed_amount ? `$${formatAmount(raise.committed_amount)}` : '$0'}
          />
          <Stat label="Days left" value={daysLeft !== null ? String(daysLeft) : '—'} />
        </div>

        {raise.target_amount ? (
          <RaiseProgress
            pct={pct}
            committed={raise.committed_amount ?? 0}
            target={raise.target_amount}
          />
        ) : null}
      </div>

      {/* Pitch */}
      {raise.raise_summary && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#7a899e]">
            About
          </h2>
          <p className="text-sm leading-relaxed text-[#94a3b8]">{raise.raise_summary}</p>
        </section>
      )}

      {/* Deck CTA */}
      {raise.deck_url && (
        <a
          href={raise.deck_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-8 flex items-center gap-2 w-fit rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm text-[#cbd5e1] transition hover:bg-white/[0.07]"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-4 w-4"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          View pitch deck
        </a>
      )}

      {/* FundExecs trust badge */}
      <div className="mb-8 flex items-center gap-2 rounded-xl border border-[rgba(247,201,72,0.2)] bg-[rgba(247,201,72,0.06)] px-4 py-3">
        <img src="/earn-coin.png" alt="" className="h-5 w-5" />
        <span className="text-xs text-[#94a3b8]">
          Curated and verified by <span className="text-[#f7c948] font-medium">FundExecs OS</span>{' '}
          GPs
        </span>
      </div>

      {/* Interest form */}
      <section>
        <h2 className="mb-4 text-sm font-semibold text-white">Express interest</h2>
        <InterestForm dealId={raise.id} />
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-widest text-[#7a899e] mb-1">
        {label}
      </div>
      <div className="text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
