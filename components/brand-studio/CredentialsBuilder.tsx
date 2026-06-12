'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  X
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';
import { publishBrandAsset } from '@/lib/brand-studio/actions';
import {
  TR_REC_CREDS,
  TR_REC_DEALS,
  TR_RECOGNITION_OPTS,
  trAgg,
  type CredentialsSpec,
  type TrackDeal
} from '@/lib/brand-studio/config';
import { cn } from '@/lib/utils';
import { BuilderHeader, BuildingScreen, EarnAside, useBuildSequence } from './builder-kit';

const STEPS = [
  'Structure your deal history',
  'Verify & compute performance',
  'Format the track-record record',
  'Publish to profile & data room'
];

const SUMMARY_TONES: Record<string, string> = {
  azure: 'var(--accent)',
  success: 'var(--success)',
  gold: 'var(--gold-1)',
  info: 'var(--info)'
};

function Summary({ deals }: { deals: TrackDeal[] }) {
  const agg = trAgg(deals);
  const cells: [string, string | number, string][] = [
    ['Deals', agg.count, 'azure'],
    ['Realized', agg.realized, 'success'],
    ['Blended MOIC', `${agg.blended}x`, 'gold'],
    ['Top deal', `${agg.top}x`, 'info']
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {cells.map(([l, v, t]) => (
        <div key={l} className="rounded-[12px] border border-hairline bg-surface-1 px-3 py-2.5">
          <div className="text-[10.5px] text-fg-4">{l}</div>
          <div
            className="mt-1 text-[19px] font-semibold tabular-nums"
            style={{ color: SUMMARY_TONES[t] }}
          >
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

const EMPTY_DEAL: TrackDeal = { company: '', year: '', multiple: '', status: 'Realized' };

const cellInput =
  'rounded-[9px] border border-hairline bg-surface-1 px-2.5 py-2 text-[12.5px] text-fg-1 placeholder:text-fg-5 focus:border-[var(--accent)] focus:outline-none';

/**
 * The prototype's credentials & track-record builder: the deal table with a
 * live computed performance summary, education, and recognition picks. The
 * aggregate is recomputed server-side at publish — the client's numbers are
 * presentation only.
 */
export function CredentialsBuilder({
  initial,
  alreadyLive,
  startProduced,
  onBack,
  onProduced,
  onPublished
}: {
  initial: CredentialsSpec | null;
  alreadyLive: boolean;
  startProduced: boolean;
  onBack: () => void;
  onProduced: (spec: CredentialsSpec) => void;
  onPublished: (spec: CredentialsSpec) => void;
}) {
  const [deals, setDeals] = useState<TrackDeal[]>(() =>
    initial?.deals?.length ? initial.deals.map((d) => ({ ...d })) : [{ ...EMPTY_DEAL }]
  );
  const [edu, setEdu] = useState(initial?.edu ?? '');
  const [recognition, setRecognition] = useState<string[]>(initial?.recognition ?? []);
  const [applied, setApplied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const { phase, n, begin, backToEdit } = useBuildSequence(
    STEPS.length,
    alreadyLive || startProduced
  );

  const setDeal = (i: number, k: keyof TrackDeal, v: string) =>
    setDeals((p) => p.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const toggleRec = (v: string) =>
    setRecognition((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  const spec = (): CredentialsSpec => ({ deals, edu, recognition, agg: trAgg(deals) });

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const out = spec();
      const res = await publishBrandAsset('credentials', out);
      if (res.ok) onPublished(out);
      else setPublishError(res.error);
    } catch {
      setPublishError('Could not publish — check your connection and try again.');
    } finally {
      setPublishing(false);
    }
  }

  if (phase === 'building')
    return <BuildingScreen heading="Verifying your track record…" steps={STEPS} n={n} />;

  if (phase === 'done') {
    const filled = deals.filter((d) => d.company);
    return (
      <div className="mx-auto flex w-full max-w-[600px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
          Track record — {alreadyLive ? 'live' : 'verified'}
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          {alreadyLive
            ? 'Structured, computed and published to your profile, deck and data room.'
            : 'Structured and computed — publish to put it on your profile, deck and data room.'}
        </p>
        <div className="mt-4 w-full">
          <Summary deals={deals} />
        </div>
        {filled.length > 0 && (
          <div className="mt-3 w-full overflow-hidden rounded-[13px] border border-hairline">
            {filled.map((d, i) => (
              <div
                key={`${d.company}-${i}`}
                className={cn(
                  'flex items-center gap-3 px-[15px] py-2.5',
                  i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                  i > 0 && 'border-t border-[var(--border-faint)]'
                )}
              >
                <span className="flex-1 text-[12.5px] font-semibold text-fg-1">
                  {d.company} <span className="font-normal text-fg-5">· {d.year || '—'}</span>
                </span>
                <Badge
                  tone={d.status === 'Realized' ? 'success' : 'neutral'}
                  className="text-[9.5px]"
                >
                  {d.status}
                </Badge>
                <span className="font-mono text-[13px] font-semibold text-gold-1">
                  {Number.isFinite(parseFloat(d.multiple))
                    ? `${parseFloat(d.multiple).toFixed(1)}x`
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
        {(edu || recognition.length > 0) && (
          <div className="mt-3 flex w-full flex-wrap gap-1.5">
            {edu && (
              <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-2">
                {edu}
              </span>
            )}
            {recognition.map((r) => (
              <span
                key={r}
                className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-2"
              >
                {r}
              </span>
            ))}
          </div>
        )}
        {publishError && (
          <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={15} aria-hidden />
            {publishError}
          </div>
        )}
        <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button variant="ghost" icon={Pencil} onClick={backToEdit}>
            Go back &amp; edit
          </Button>
          {alreadyLive ? (
            <Button variant="outline" iconRight={Check} onClick={onBack}>
              Close
            </Button>
          ) : (
            <Button
              variant="gold"
              icon={publishing ? Loader2 : undefined}
              iconRight={publishing ? undefined : Check}
              disabled={publishing}
              onClick={() => void publish()}
            >
              {publishing ? 'Publishing…' : 'Publish & finish'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BuilderHeader
        title="Credentials & track record"
        sub="The proof LPs scrutinize most · Earn structures & verifies it"
        onBack={onBack}
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Eyebrow>
              Track record
              <span className="font-normal normal-case tracking-normal text-fg-5">
                {' '}
                · your prior deals
              </span>
            </Eyebrow>
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              onClick={() => setDeals((p) => [...p, { ...EMPTY_DEAL }])}
            >
              Add deal
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {deals.map((d, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_64px_64px_96px_28px] items-center gap-2"
              >
                <input
                  value={d.company}
                  onChange={(e) => setDeal(i, 'company', e.target.value)}
                  placeholder="Company"
                  aria-label={`Deal ${i + 1} company`}
                  className={cellInput}
                />
                <input
                  value={d.year}
                  onChange={(e) => setDeal(i, 'year', e.target.value)}
                  placeholder="Year"
                  aria-label={`Deal ${i + 1} year`}
                  className={cellInput}
                />
                <input
                  value={d.multiple}
                  onChange={(e) => setDeal(i, 'multiple', e.target.value)}
                  placeholder="3.2"
                  aria-label={`Deal ${i + 1} multiple`}
                  className={cn(cellInput, 'font-mono text-gold-1')}
                />
                <button
                  type="button"
                  onClick={() =>
                    setDeal(i, 'status', d.status === 'Realized' ? 'Unrealized' : 'Realized')
                  }
                  className={cn(
                    'rounded-[9px] border border-hairline bg-surface-1 px-1.5 py-2 text-[10.5px] font-semibold transition hover:bg-surface-2',
                    d.status === 'Realized' ? 'text-success' : 'text-fg-4'
                  )}
                >
                  {d.status}
                </button>
                <button
                  type="button"
                  onClick={() => setDeals((p) => p.filter((_, j) => j !== i))}
                  aria-label={`Remove deal ${i + 1}`}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-5 hover:bg-surface-1"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <Eyebrow className="mb-2 mt-5">Credentials</Eyebrow>
          <Field
            label="Education"
            icon={GraduationCap}
            value={edu}
            onChange={setEdu}
            placeholder="MBA, Wharton"
          />
          <Eyebrow className="mb-2 mt-4">
            Recognition
            <span className="font-normal normal-case tracking-normal text-fg-5"> · pick any</span>
          </Eyebrow>
          <div className="flex flex-wrap gap-2">
            {TR_RECOGNITION_OPTS.map((o) => (
              <Chip
                key={o}
                label={o}
                selected={recognition.includes(o)}
                onClick={() => toggleRec(o)}
              />
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
            <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
              Cancel
            </Button>
            <Button
              variant="gold"
              iconRight={Sparkles}
              onClick={() => {
                onProduced(spec());
                begin();
              }}
            >
              Verify &amp; publish
            </Button>
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-[17px]">
            <Eyebrow className="mb-2.5 flex items-center gap-1.5">
              <TrendingUp size={12} className="text-gold-1" aria-hidden />
              Live performance
            </Eyebrow>
            <Summary deals={deals} />
          </Card>
          <EarnAside
            copilotSub="Track-record copilot"
            note="Net-to-LP multiples on realized deals carry the most weight. I'll verify each, compute a blended MOIC, and flag anything an LP's ODD team will question."
            applied={applied}
            applyLabel="Import from my history"
            onApply={() => {
              setDeals(TR_REC_DEALS.map((d) => ({ ...d })));
              setEdu(TR_REC_CREDS.edu);
              setRecognition([...TR_REC_CREDS.recognition]);
              setApplied(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
