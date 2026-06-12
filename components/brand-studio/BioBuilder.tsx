'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  Award,
  Briefcase,
  Check,
  Clock,
  Eye,
  GraduationCap,
  Loader2,
  Pencil,
  Sparkles,
  TriangleAlert
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';
import { publishBrandAsset } from '@/lib/brand-studio/actions';
import { BIO_REC, composeBio, type BioSpec } from '@/lib/brand-studio/config';
import { BuilderHeader, BuildingScreen, EarnAside, useBuildSequence } from './builder-kit';

const STEPS = [
  'Pull your fund story & inputs',
  'Draft your bio',
  'Tune to your posture & length',
  'Publish to your profile'
];

/**
 * The prototype's dedicated bio builder: you give the facts, Earn writes the
 * paragraph — the preview composes live. Publishing persists the composed
 * text alongside the decisions.
 */
export function BioBuilder({
  principal,
  firm,
  initial,
  alreadyLive,
  startProduced,
  onBack,
  onProduced,
  onPublished
}: {
  principal: string;
  firm: string;
  initial: BioSpec | null;
  alreadyLive: boolean;
  startProduced: boolean;
  onBack: () => void;
  onProduced: (spec: BioSpec) => void;
  onPublished: (spec: BioSpec) => void;
}) {
  const [d, setD] = useState<Omit<BioSpec, 'text'>>(() => ({
    voice: 'Operator',
    length: 'Standard',
    include: ['Track record', 'Thesis'],
    years: '',
    prior: '',
    win: '',
    edu: '',
    ...(initial ?? {})
  }));
  const [applied, setApplied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const { phase, n, begin, backToEdit } = useBuildSequence(
    STEPS.length,
    alreadyLive || startProduced
  );

  const set = (k: keyof Omit<BioSpec, 'text' | 'include'>, v: string) =>
    setD((p) => ({ ...p, [k]: v }));
  const toggle = (v: string) =>
    setD((p) => ({
      ...p,
      include: p.include.includes(v) ? p.include.filter((x) => x !== v) : [...p.include, v]
    }));

  const preview = composeBio(d, principal, firm);
  const spec = (): BioSpec => ({ ...d, text: preview });

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const out = spec();
      const res = await publishBrandAsset('bio', out);
      if (res.ok) onPublished(out);
      else setPublishError(res.error);
    } catch {
      setPublishError('Could not publish — check your connection and try again.');
    } finally {
      setPublishing(false);
    }
  }

  if (phase === 'building')
    return <BuildingScreen heading="Writing your bio…" steps={STEPS} n={n} />;

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
          Professional bio — {alreadyLive ? 'live' : 'written'}
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          {alreadyLive
            ? 'Published to your profile, deck and data room. It updates everywhere if you edit it.'
            : 'Written to your posture — publish to put it on your profile, deck and data room.'}
        </p>
        <Card className="mt-4 w-full bg-surface-1 p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <Avatar name={principal} size={38} tone="gold" />
            <div>
              <div className="text-[13.5px] font-semibold text-fg-1">{principal}</div>
              <div className="text-[11px] text-gold-1">Managing Partner · {firm}</div>
            </div>
          </div>
          <p className="text-[12.5px] leading-[1.65] text-fg-2">{preview}</p>
        </Card>
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
        title="Professional bio"
        sub="You give the facts, Earn writes it — watch it compose live"
        onBack={onBack}
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <Eyebrow className="mb-3">
            The facts
            <span className="font-normal normal-case tracking-normal text-fg-5">
              {' '}
              · leave blank and Earn fills in
            </span>
          </Eyebrow>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Years in the sector"
              icon={Clock}
              value={d.years}
              onChange={(v) => set('years', v)}
              placeholder="10"
            />
            <Field
              label="Prior role / firm"
              icon={Briefcase}
              value={d.prior}
              onChange={(v) => set('prior', v)}
              placeholder="Head of Ops, Acme Inc."
            />
            <Field
              label="Notable win"
              icon={Award}
              value={d.win}
              onChange={(v) => set('win', v)}
              placeholder="3 exits, $400M created"
            />
            <Field
              label="Education"
              icon={GraduationCap}
              value={d.edu}
              onChange={(v) => set('edu', v)}
              placeholder="MBA, Wharton"
            />
          </div>
          <Eyebrow className="mb-2 mt-5">Position as</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {['Operator', 'Investor', 'Visionary'].map((o) => (
              <Chip key={o} label={o} selected={d.voice === o} onClick={() => set('voice', o)} />
            ))}
          </div>
          <Eyebrow className="mb-2 mt-5">
            Highlight
            <span className="font-normal normal-case tracking-normal text-fg-5"> · pick any</span>
          </Eyebrow>
          <div className="flex flex-wrap gap-2">
            {['Track record', 'Operating wins', 'Thesis', 'Network', 'Education'].map((o) => (
              <Chip key={o} label={o} selected={d.include.includes(o)} onClick={() => toggle(o)} />
            ))}
          </div>
          <Eyebrow className="mb-2 mt-5">Length</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {['Short', 'Standard', 'Full'].map((o) => (
              <Chip key={o} label={o} selected={d.length === o} onClick={() => set('length', o)} />
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
              Write &amp; publish
            </Button>
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-[17px]">
            <Eyebrow className="mb-2.5 flex items-center gap-1.5">
              <Eye size={12} className="text-gold-1" aria-hidden />
              Live preview
            </Eyebrow>
            <div className="mb-2.5 flex items-center gap-2.5">
              <Avatar name={principal} size={34} tone="gold" />
              <div>
                <div className="text-[12.5px] font-semibold text-fg-1">{principal}</div>
                <div className="text-[10.5px] text-gold-1">Managing Partner · {firm}</div>
              </div>
            </div>
            <p className="text-[12px] leading-[1.6] text-fg-2">{preview}</p>
          </Card>
          <EarnAside
            copilotSub="Brand copilot"
            note="Position as an operator — LPs back people who've done the work. Leave a field blank and I'll fill it from your fund story."
            applied={applied}
            onApply={() => {
              setD((p) => ({ ...p, ...BIO_REC }));
              setApplied(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
