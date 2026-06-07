import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles, type LucideIcon } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ComingSoonPageProps {
  /** Logic-area eyebrow ("Source of Truth", "Capital Formation", …). */
  area: string;
  /** Module title ("Trust Center", "LP Pipeline", …). */
  title: string;
  /** One-line summary of what this module will do. */
  blurb: string;
  /** 2–4 capability bullets — the spec promises this module will deliver. */
  capabilities: string[];
  /** Icon for the placeholder avatar disc. */
  icon: LucideIcon;
  /** Stage in the 7-stage lifecycle this module primarily serves
   *  (used for the rail emphasis breadcrumb here — purely decorative). */
  stageLabel?: string;
  /** Where the "back" CTA returns to. Defaults to /command-center. */
  backHref?: string;
  backLabel?: string;
  /** Optional secondary CTA — e.g. "Ask Earn what we'll do here". */
  askEarnHref?: string;
  /** Optional live data preview rendered above the capability bullets — used
   *  where a real loader already exists (e.g. Capital Stack raise progress) so
   *  the stub shows real numbers instead of pure placeholder copy. */
  preview?: ReactNode;
  className?: string;
}

/**
 * ComingSoonPage — the tasteful placeholder mounted by the 11 not-yet-built
 * Wave-1 rail destinations. Single component, per-route copy. Reads as a
 * deliberate sprint stub (not a dead link): logic-area eyebrow, module title,
 * blurb, capability bullets, "Back to dashboard" CTA + optional Ask Earn
 * secondary. Solid `bg-bg-1`. No inline hex.
 */
export function ComingSoonPage({
  area,
  title,
  blurb,
  capabilities,
  icon: Icon,
  stageLabel,
  backHref = '/command-center',
  backLabel = 'Back to dashboard',
  askEarnHref = '/ask-earn',
  preview,
  className
}: ComingSoonPageProps) {
  return (
    <div className={cn('mx-auto max-w-[860px]', className)} data-testid="coming-soon-page">
      <Card className="relative overflow-hidden p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 130% at 0% 0%, rgba(91,141,239,0.08), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(247,201,72,0.06), transparent 65%)'
          }}
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <span className="relative flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-hairline bg-bg-1 text-gold-1 shadow-[var(--shadow-sm)]">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-2xl"
              style={{ boxShadow: 'var(--shadow-glow-gold)' }}
            />
            <Icon size={20} strokeWidth={1.9} className="relative" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
              {area}
              {stageLabel ? <span className="text-fg-4"> · stage · {stageLabel}</span> : null}
            </p>
            <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.018em] text-fg-1 sm:text-[28px]">
              {title}
            </h1>
            <p className="mt-1 max-w-[58ch] text-[13px] text-fg-3">{blurb}</p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-azure-1">
              <Sparkles size={11} strokeWidth={2} aria-hidden />
              Coming this sprint
            </p>
          </div>
        </div>

        {preview ? <div className="mt-7">{preview}</div> : null}

        <SectionTitle
          eyebrow="What this surface will do"
          title="The work this module owns"
          className="mt-7"
        />
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {capabilities.map((cap, idx) => (
            <li
              key={cap}
              className="flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3.5 py-2.5"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] text-[10px] font-semibold text-azure-1">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="text-[12.5px] leading-relaxed text-fg-2">{cap}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-[60ch] text-[11.5px] text-fg-4">
          Every interaction in this module will be on the record, audit-ready, and documented as it
          forms — Earn coordinates the work and your Chain of Trust captures the proof.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={backHref}
            data-testid="coming-soon-back-cta"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2 text-[12.5px] font-semibold text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
          >
            <ArrowLeft size={13} strokeWidth={2} aria-hidden />
            {backLabel}
          </Link>
          <Link
            href={askEarnHref}
            data-testid="coming-soon-earn-cta"
            className="inline-flex items-center gap-1.5 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Ask Earn what this unlocks
            <Sparkles size={13} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default ComingSoonPage;
