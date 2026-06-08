'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Check,
  ArrowLeft,
  ArrowRight,
  Scale,
  ExternalLink,
  Copy,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  createRaiseShareLink,
  updateRaisePage,
  type RaiseExemption
} from '@/lib/actions/raise-page';
import type { ActiveRaisePage } from '@/lib/queries/raise-page';

/* ----------------------------------------------------------------------------
 * RaiseSetupWizard (W4) — a guided, resumable raise-setup journey that walks an
 * owner from blank → published raise page: Terms → Sizing → Compliance →
 * Review. Reuses the existing raise-page server actions; the Compliance step
 * explains Reg D 506(b)/(c) and routes the operator to legal counsel in the
 * partner directory. Tokens-only; no setState-in-effect.
 * --------------------------------------------------------------------------*/

type StepId = 'terms' | 'sizing' | 'compliance' | 'review';
const STEPS: { id: StepId; label: string; icon: LucideIcon }[] = [
  { id: 'terms', label: 'Terms', icon: ShieldCheck },
  { id: 'sizing', label: 'Sizing', icon: ArrowRight },
  { id: 'compliance', label: 'Compliance', icon: Scale },
  { id: 'review', label: 'Review', icon: Check }
];

export function RaiseSetupWizard({ initial }: { initial: ActiveRaisePage | null }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(initial?.url ?? null);
  const [copied, setCopied] = useState(false);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [minCheck, setMinCheck] = useState(initial?.minCheck ? String(initial.minCheck) : '');
  const [showAmounts, setShowAmounts] = useState(initial?.showAmounts ?? false);
  const [exemption, setExemption] = useState<'' | RaiseExemption>(initial?.exemption ?? '');
  const [acceptReservations, setAcceptReservations] = useState(
    initial?.acceptReservations ?? false
  );

  const step = STEPS[stepIndex].id;
  const isLast = stepIndex === STEPS.length - 1;

  function next() {
    setError(null);
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }
  function back() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function publish() {
    setError(null);
    startTransition(async () => {
      try {
        const link = await createRaiseShareLink();
        if (!link.ok) {
          setError(link.error);
          return;
        }
        const saved = await updateRaisePage({
          title,
          headline,
          minCheck: minCheck ? Number(minCheck.replace(/[^0-9.]/g, '')) : null,
          showAmounts,
          exemption: exemption || null,
          acceptReservations
        });
        if (!saved.ok) {
          setError(saved.error);
          return;
        }
        setPublishedUrl(link.url);
      } catch {
        setError('Could not publish the raise page. Please try again.');
      }
    });
  }

  async function copy() {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — URL is visible to copy manually */
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Step rail */}
      <ol className="flex items-center gap-2" aria-label="Raise setup steps">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          const Icon = s.icon;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold transition',
                  active
                    ? 'border-accent-line bg-accent-soft text-accent'
                    : done
                      ? 'border-success-line bg-success-soft text-success'
                      : 'border-hairline bg-surface-1 text-fg-4'
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? (
                  <Check size={13} strokeWidth={2.4} aria-hidden />
                ) : (
                  <Icon size={13} aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  'hidden text-[12px] font-medium sm:inline',
                  active ? 'text-fg-1' : done ? 'text-fg-2' : 'text-fg-4'
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 ? (
                <span className="mx-1 hidden h-px flex-1 bg-hairline sm:block" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>

      <Card className="p-6">
        {step === 'terms' ? (
          <StepShell title="Terms" hint="What you're raising, in your words.">
            <Field label="Title" hint="Defaults to your workspace name">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="e.g. Acme Fund II"
                className={inputCls}
              />
            </Field>
            <Field label="Headline" hint="One line on the raise and why now">
              <textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                rows={3}
                maxLength={280}
                placeholder="A short, compelling summary prospects see first."
                className={`${inputCls} resize-none`}
              />
            </Field>
          </StepShell>
        ) : null}

        {step === 'sizing' ? (
          <StepShell title="Sizing" hint="Minimum check and what's shown publicly.">
            <Field label="Minimum check ($)" hint="Optional">
              <input
                value={minCheck}
                onChange={(e) => setMinCheck(e.target.value)}
                inputMode="numeric"
                maxLength={16}
                placeholder="e.g. 50000"
                className={inputCls}
              />
            </Field>
            <label className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <input
                type="checkbox"
                checked={showAmounts}
                onChange={(e) => setShowAmounts(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[12.5px] text-fg-2">
                Show dollar amounts (committed / target) on the public page
              </span>
            </label>
            <label className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <input
                type="checkbox"
                checked={acceptReservations}
                onChange={(e) => setAcceptReservations(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
                disabled={exemption !== '506c'}
              />
              <span className={`text-[12.5px] ${exemption !== '506c' ? 'text-fg-4' : 'text-fg-2'}`}>
                Accept reservations via Stripe (506(c) raises only)
              </span>
            </label>
            <p className="text-[11.5px] text-fg-4">
              When off, the page shows momentum as percentages only. A 506(b) raise always hides
              amounts (next step).
            </p>
          </StepShell>
        ) : null}

        {step === 'compliance' ? (
          <StepShell
            title="Compliance"
            hint="Pick the Reg D exemption your raise runs under — it changes how the public page behaves."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ExemptionCard
                value="506c"
                selected={exemption === '506c'}
                onSelect={() => setExemption('506c')}
                title="Reg D 506(c)"
                tagline="General solicitation OK"
                points={[
                  'You may publicly market the raise',
                  'All investors must be verified accredited',
                  'Public page shows the open “express interest” CTA'
                ]}
              />
              <ExemptionCard
                value="506b"
                selected={exemption === '506b'}
                onSelect={() => setExemption('506b')}
                title="Reg D 506(b)"
                tagline="Private — no public solicitation"
                points={[
                  'No general solicitation or public marketing',
                  'Up to 35 non-accredited sophisticated investors',
                  'Public page is gated to “request access”; amounts hidden'
                ]}
              />
            </div>

            {/* Guide toward legal counsel via the partner directory (W2). */}
            <div className="mt-4 rounded-xl border border-azure-line bg-azure-soft p-4">
              <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-1">
                <Scale size={14} strokeWidth={2} className="text-azure-1" aria-hidden />
                Get this reviewed by counsel
              </p>
              <p className="mt-1 max-w-[64ch] text-[12.5px] text-fg-3">
                Choosing an exemption, filing Form D, preparing investor documents, and verifying
                accreditation are legal work. Match with a securities attorney in your network
                before you publish — FundExecs isn&rsquo;t a substitute for legal advice.
              </p>
              <Link
                href="/partners"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-azure-1 px-3.5 py-2 text-[12.5px] font-semibold text-[#070b14] transition hover:brightness-110"
              >
                <Scale size={14} strokeWidth={2.2} aria-hidden />
                Match with legal counsel in the directory
                <ArrowRight size={13} strokeWidth={2.2} aria-hidden />
              </Link>
            </div>
          </StepShell>
        ) : null}

        {step === 'review' ? (
          <StepShell title="Review & publish" hint="Confirm and publish your link-only raise page.">
            {publishedUrl ? (
              <div className="rounded-2xl border border-success-line bg-success-soft p-5 text-center">
                <ShieldCheck
                  className="mx-auto mb-2 text-success"
                  size={26}
                  strokeWidth={2}
                  aria-hidden
                />
                <h3 className="text-[15px] font-semibold text-fg-1">Raise page is live</h3>
                <p className="mx-auto mt-1 max-w-[48ch] text-[12.5px] text-fg-3">
                  Share this private link. It isn&rsquo;t search-indexed.
                </p>
                <div className="mx-auto mt-3 flex max-w-md flex-wrap items-center gap-2 rounded-xl border border-hairline bg-bg-2 px-3 py-2">
                  <span className="truncate text-[12.5px] text-fg-2">{publishedUrl}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button type="button" onClick={copy} className={pillCls}>
                      {copied ? (
                        <Check size={12} strokeWidth={2.4} className="text-success" aria-hidden />
                      ) : (
                        <Copy size={12} strokeWidth={2} aria-hidden />
                      )}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <a
                      href={publishedUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={pillCls}
                    >
                      <ExternalLink size={12} strokeWidth={2} aria-hidden />
                      Open
                    </a>
                  </div>
                </div>
                <Link
                  href="/capital-stack"
                  className="mt-4 inline-flex rounded-xl border border-hairline px-4 py-2 text-[12.5px] font-medium text-fg-2 transition hover:bg-surface-2"
                >
                  Back to Capital Stack
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <ReviewRow label="Title" value={title || 'Workspace name'} />
                <ReviewRow label="Headline" value={headline || '—'} />
                <ReviewRow label="Minimum check" value={minCheck ? `$${minCheck}` : '—'} />
                <ReviewRow
                  label="Public amounts"
                  value={
                    exemption === '506b'
                      ? 'Hidden (506(b))'
                      : showAmounts
                        ? 'Shown'
                        : 'Percentages only'
                  }
                />
                <ReviewRow
                  label="Exemption"
                  value={
                    exemption === '506b'
                      ? '506(b) — private'
                      : exemption === '506c'
                        ? '506(c) — solicitation OK'
                        : 'Unset'
                  }
                />
                <ReviewRow
                  label="Accept reservations"
                  value={
                    exemption !== '506c'
                      ? 'N/A (506(c) only)'
                      : acceptReservations
                        ? 'Yes — Stripe Checkout enabled'
                        : 'No'
                  }
                />
                <button
                  type="button"
                  onClick={publish}
                  disabled={pending}
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[var(--shadow-md)] transition hover:bg-accent-2 disabled:opacity-60"
                >
                  {pending ? 'Publishing…' : 'Publish raise page'}
                </button>
              </div>
            )}
          </StepShell>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-[12.5px] text-danger">
            {error}
          </p>
        ) : null}

        {/* Nav */}
        {!publishedUrl ? (
          <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4">
            <button
              type="button"
              onClick={back}
              disabled={stepIndex === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline px-3.5 py-2 text-[12.5px] font-medium text-fg-2 transition hover:bg-surface-2 disabled:opacity-40"
            >
              <ArrowLeft size={14} strokeWidth={2} aria-hidden />
              Back
            </button>
            {!isLast ? (
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-accent-2"
              >
                Next
                <ArrowRight size={14} strokeWidth={2.2} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ---- presentational helpers ---------------------------------------------- */

const inputCls =
  'w-full rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[13.5px] text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-accent-line focus:bg-surface-2';
const pillCls =
  'inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-1 px-2.5 py-1 text-[11.5px] font-medium text-fg-2 transition hover:bg-surface-2';

function StepShell({
  title,
  hint,
  children
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg-1">{title}</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-3">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[11.5px] font-medium text-fg-2">
        <span>{label}</span>
        {hint ? <span className="font-normal text-fg-4">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function ExemptionCard({
  value,
  selected,
  onSelect,
  title,
  tagline,
  points
}: {
  value: RaiseExemption;
  selected: boolean;
  onSelect: () => void;
  title: string;
  tagline: string;
  points: string[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-value={value}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4 text-left transition',
        selected
          ? 'border-accent-line bg-accent-soft ring-1 ring-[var(--accent-line)]'
          : 'border-hairline bg-surface-1 hover:bg-surface-2'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-semibold text-fg-1">{title}</span>
        <span
          className={cn(
            'inline-flex h-4 w-4 items-center justify-center rounded-full border',
            selected ? 'border-accent bg-accent text-white' : 'border-hairline'
          )}
          aria-hidden
        >
          {selected ? <Check size={11} strokeWidth={3} /> : null}
        </span>
      </div>
      <span className="text-[11.5px] font-medium text-accent">{tagline}</span>
      <ul className="mt-1 flex flex-col gap-1">
        {points.map((p) => (
          <li key={p} className="flex gap-1.5 text-[12px] text-fg-3">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline py-2 last:border-0">
      <span className="text-[12px] text-fg-4">{label}</span>
      <span className="max-w-[60%] truncate text-right text-[12.5px] font-medium text-fg-1">
        {value}
      </span>
    </div>
  );
}
