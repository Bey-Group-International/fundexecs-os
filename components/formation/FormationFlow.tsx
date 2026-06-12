'use client';

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bookmark,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock,
  Feather,
  FileSignature,
  FileText,
  FolderOpen,
  GraduationCap,
  Globe,
  Hand,
  Info,
  Landmark,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  Megaphone,
  PenLine,
  Pencil,
  Route,
  Scale,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Input } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Select } from '@/components/ui/Select';
import { fileFormationStep, saveFormationDraft } from '@/lib/formation/actions';
import {
  FORMATION_ARC,
  FORMATION_ITEMS,
  F_EDGES,
  F_ENTITY_OPTS,
  F_EXEMPTION_OPTS,
  F_REC,
  F_REC_TEXT,
  fileSteps,
  fundIdFor,
  itemUndecided,
  resultRows,
  type FormationData,
  type FormationItem,
  type FormationKind,
  type FormationOption
} from '@/lib/formation/config';
import { cn } from '@/lib/utils';

/* ── icon resolver — the prototype's kebab names → lucide ─────────────────── */
const ICONS: Record<string, LucideIcon> = {
  feather: Feather,
  landmark: Landmark,
  scale: Scale,
  'file-text': FileText,
  'pen-line': PenLine,
  'shield-check': ShieldCheck,
  banknote: Banknote,
  globe: Globe,
  layers: Layers,
  'circle-help': CircleHelp,
  lock: Lock,
  megaphone: Megaphone
};
function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}

/* ── small building blocks ───────────────────────────────────────────────── */

function Chip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
      )}
    >
      {selected && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {label}
    </button>
  );
}

function ChoiceCard({
  opt,
  selected,
  onClick
}: {
  opt: FormationOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-[13px] border px-3.5 py-3 text-left transition',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_var(--accent-line)]'
          : 'border-hairline bg-surface-1 hover:bg-surface-2'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 flex-none items-center justify-center rounded-[11px]',
          selected
            ? 'bg-[var(--accent)] text-white'
            : 'border border-hairline bg-surface-2 text-fg-3'
        )}
      >
        {createElement(iconFor(opt.icon), { size: 17, strokeWidth: 1.9, 'aria-hidden': true })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg-1">{opt.label}</span>
          {opt.recommended && (
            <Badge tone="gold" className="px-1.5 py-px text-[9px]">
              Recommended
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block text-[11.5px] text-fg-4">{opt.sub}</span>
      </span>
      <span
        className={cn(
          'flex h-5 w-5 flex-none items-center justify-center rounded-full border',
          selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border-strong)]'
        )}
      >
        {selected && <Check size={13} strokeWidth={2.4} className="text-white" aria-hidden />}
      </span>
    </button>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

function FSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  hint,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-fg-3">{label}</span>
        <span className="font-mono text-[14px] font-semibold text-gold-1">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="w-full cursor-pointer accent-[var(--accent)]"
      />
      {hint && <div className="mt-1.5 text-[11px] text-fg-5">{hint}</div>}
    </div>
  );
}

function FToggle({
  label,
  sub,
  on,
  onClick
}: {
  label: string;
  sub?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
    >
      <span
        className={cn(
          'relative h-[22px] w-[38px] flex-none rounded-full transition-colors',
          on ? 'bg-[var(--accent)]' : 'bg-surface-3'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-[left]',
            on ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-fg-1">{label}</span>
        {sub && <span className="block text-[11px] text-fg-5">{sub}</span>}
      </span>
    </button>
  );
}

/** A select-style field over a fixed option list (mirrors the prototype's Field). */
function OptionField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options.map((o) => ({ value: o, label: o }))}
    />
  );
}

/* ── the editor for a single copiloted step ──────────────────────────────── */

function StepEditor({
  kind,
  d,
  set
}: {
  kind: FormationKind;
  d: FormationData;
  set: <K extends keyof FormationData>(k: K, v: FormationData[K]) => void;
}) {
  if (kind === 'story') {
    return (
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg-3">
            Your fund in one line <span className="font-normal text-fg-5">· the positioning</span>
          </span>
          <textarea
            value={d.storyHook}
            onChange={(e) => set('storyHook', e.target.value)}
            rows={2}
            placeholder="e.g. A focused fund backing overlooked industrial operators with an unfair sourcing edge."
            className="resize-y rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[13.5px] leading-relaxed text-fg-1 placeholder:text-fg-5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg-3">
            Origin <span className="font-normal text-fg-5">· why you, why this</span>
          </span>
          <textarea
            value={d.storyOrigin}
            onChange={(e) => set('storyOrigin', e.target.value)}
            rows={3}
            placeholder="The experience or insight that led you here. What do you see that others miss?"
            className="resize-y rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[13.5px] leading-relaxed text-fg-1 placeholder:text-fg-5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]"
          />
        </label>
        <div>
          <Eyebrow className="mb-2">
            Your edge{' '}
            <span className="font-normal normal-case tracking-normal text-fg-5">
              · pick what&apos;s true
            </span>
          </Eyebrow>
          <div className="flex flex-wrap gap-2">
            {F_EDGES.map((e) => {
              const on = d.storyEdges.includes(e);
              return (
                <Chip
                  key={e}
                  label={e}
                  selected={on}
                  onClick={() =>
                    set(
                      'storyEdges',
                      on ? d.storyEdges.filter((x) => x !== e) : [...d.storyEdges, e]
                    )
                  }
                />
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg-3">
            Why now <span className="font-normal text-fg-5">· the timing</span>
          </span>
          <textarea
            value={d.storyWhyNow}
            onChange={(e) => set('storyWhyNow', e.target.value)}
            rows={2}
            placeholder="What's changed in the market that makes this the moment?"
            className="resize-y rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[13.5px] leading-relaxed text-fg-1 placeholder:text-fg-5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]"
          />
        </label>
      </div>
    );
  }

  if (kind === 'structure') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          {F_ENTITY_OPTS.map((o) => (
            <ChoiceCard
              key={o.id}
              opt={o}
              selected={d.entity === o.id}
              onClick={() => set('entity', o.id)}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Input
            label="Domicile"
            icon={MapPin}
            value={d.domicile}
            onChange={(e) => set('domicile', e.target.value)}
          />
          <Input
            label="GP entity"
            icon={Briefcase}
            value={d.gp}
            onChange={(e) => set('gp', e.target.value)}
          />
          <Input
            label="Management company"
            icon={Building2}
            value={d.mgmtco}
            onChange={(e) => set('mgmtco', e.target.value)}
          />
        </div>
      </div>
    );
  }

  if (kind === 'terms') {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => {
            for (const [k, v] of Object.entries(F_REC.terms)) {
              set(k as keyof FormationData, v as never);
            }
          }}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition',
            d.termsUndecided
              ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
              : 'border-hairline bg-surface-1'
          )}
        >
          <CircleHelp
            size={17}
            className={d.termsUndecided ? 'text-gold-1' : 'text-fg-4'}
            aria-hidden
          />
          <span className="flex-1">
            <span className="block text-[12.5px] font-semibold text-fg-1">
              I&apos;m not sure on terms yet — use the market standard
            </span>
            <span className="block text-[11px] text-fg-5">
              {d.termsUndecided
                ? 'Market-standard terms applied by Earn — adjust any slider to make them yours.'
                : 'Earn sets fair, market terms you can change anytime.'}
            </span>
          </span>
        </button>
        <div className={cn('flex flex-col gap-5', d.termsUndecided && 'opacity-70')}>
          <FSlider
            label="Management fee"
            value={d.fee}
            min={1}
            max={2.5}
            step={0.25}
            unit="%"
            hint="Market: 2.0% for emerging managers"
            onChange={(v) => {
              set('fee', v);
              set('termsUndecided', false);
            }}
          />
          <FSlider
            label="Carried interest"
            value={d.carry}
            min={10}
            max={30}
            unit="%"
            hint="Market: 20% above the hurdle"
            onChange={(v) => {
              set('carry', v);
              set('termsUndecided', false);
            }}
          />
          <FSlider
            label="Preferred return (hurdle)"
            value={d.hurdle}
            min={0}
            max={12}
            unit="%"
            hint="Market: 8% before carry accrues"
            onChange={(v) => {
              set('hurdle', v);
              set('termsUndecided', false);
            }}
          />
          <FSlider
            label="GP commitment"
            value={d.gpCommit}
            min={1}
            max={5}
            step={0.5}
            unit="%"
            hint="Skin in the game — LPs look for 1–2%+"
            onChange={(v) => {
              set('gpCommit', v);
              set('termsUndecided', false);
            }}
          />
          <FSlider
            label="Fund term"
            value={d.term}
            min={7}
            max={12}
            unit=" yrs"
            hint="Plus customary 1-year extensions"
            onChange={(v) => {
              set('term', v);
              set('termsUndecided', false);
            }}
          />
        </div>
      </div>
    );
  }

  if (kind === 'ppm') {
    return (
      <div className="flex flex-col gap-2.5">
        <FToggle
          label="Include track record"
          sub="Realized returns LPs will ask for"
          on={d.ppmTrack}
          onClick={() => set('ppmTrack', !d.ppmTrack)}
        />
        <FToggle
          label="Worked fee example"
          sub="Show fees on a sample commitment"
          on={d.ppmFee}
          onClick={() => set('ppmFee', !d.ppmFee)}
        />
        <FToggle
          label="Conflicts of interest disclosure"
          sub="Standard institutional disclosure"
          on={d.ppmConflicts}
          onClick={() => set('ppmConflicts', !d.ppmConflicts)}
        />
        <FToggle
          label="Sector-specific risk factors"
          sub="Tailored to your thesis"
          on={d.ppmSector}
          onClick={() => set('ppmSector', !d.ppmSector)}
        />
      </div>
    );
  }

  if (kind === 'subscription') {
    return (
      <div className="flex flex-col gap-3.5">
        <OptionField
          label="Minimum commitment"
          value={d.minCommit}
          options={['$100K', '$250K', '$500K', '$1M', 'Not sure yet — Earn decides']}
          onChange={(v) => set('minCommit', v)}
        />
        <OptionField
          label="Accreditation method"
          value={d.accredMethod}
          options={[
            'Self-certification (506(b))',
            'Third-party verification (506(c))',
            'Not sure yet — Earn decides'
          ]}
          onChange={(v) => set('accredMethod', v)}
        />
        <FToggle
          label="Allow side letters"
          sub="Negotiated terms for anchor LPs"
          on={d.sideLetters}
          onClick={() => set('sideLetters', !d.sideLetters)}
        />
      </div>
    );
  }

  if (kind === 'regulatory') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          {F_EXEMPTION_OPTS.map((o) => (
            <ChoiceCard
              key={o.id}
              opt={o}
              selected={d.exemption === o.id}
              onClick={() => set('exemption', o.id)}
            />
          ))}
        </div>
        <OptionField
          label="Investor eligibility"
          value={d.accred}
          options={[
            'Accredited investors only',
            'Accredited + up to 35 sophisticated',
            'Qualified purchasers (3(c)(7))',
            'Not sure yet — Earn decides'
          ]}
          onChange={(v) => set('accred', v)}
        />
        <FToggle
          label="Track ERISA / 25% benefit-plan limit"
          sub="Keep pension & retirement capital under the threshold"
          on={d.erisa}
          onClick={() => set('erisa', !d.erisa)}
        />
      </div>
    );
  }

  // bank
  return (
    <div className="flex flex-col gap-3.5">
      <OptionField
        label="Fund bank"
        value={d.bank}
        options={[
          'First Republic — fund banking',
          'SVB Private',
          'Mercury — fund accounts',
          'Not sure yet — Earn decides'
        ]}
        onChange={(v) => set('bank', v)}
      />
      <OptionField
        label="Escrow agent"
        value={d.escrow}
        options={['Standish Escrow', 'Apex Escrow Services', 'Not sure yet — Earn decides']}
        onChange={(v) => set('escrow', v)}
      />
      <OptionField
        label="Account setup"
        value={d.acctType}
        options={['Capital-call + operating', 'Operating only']}
        onChange={(v) => set('acctType', v)}
      />
    </div>
  );
}

const STEP_HEADING: Record<FormationKind, { title: string; blurb: string }> = {
  story: {
    title: 'Your fund story',
    blurb:
      'LPs back the manager before the math. This is the through-line your deck, PPM and every LP conversation inherit. Rough notes are fine — Earn shapes them.'
  },
  structure: {
    title: 'Choose your fund entity',
    blurb: 'The legal shell your capital lives in — it drives tax, reporting and who can invest.'
  },
  terms: {
    title: 'Set your LPA economics',
    blurb:
      'The deal between you and your LPs, written into the LPA. Not sure? Use the market standard.'
  },
  ppm: {
    title: 'Shape your PPM',
    blurb:
      'What goes in your offering memorandum. Earn drafts every section — you choose what to include.'
  },
  subscription: {
    title: 'Subscription terms',
    blurb: 'How LPs commit. These set the minimum check and how you verify investors.'
  },
  regulatory: {
    title: 'Reg D exemption & Form D',
    blurb:
      "How you're allowed to raise. This decides whether you can market publicly and who can invest."
  },
  bank: {
    title: 'Bank & escrow accounts',
    blurb: 'Where committed capital lands. Earn opens these with your fund admin.'
  }
};

/* ── one copiloted step (edit → filing → done) ───────────────────────────── */

function FormationStep({
  item,
  index,
  total,
  completedCount,
  d,
  setD,
  onClose,
  onCompleted,
  nextItem,
  onOpenNext
}: {
  item: FormationItem;
  index: number;
  total: number;
  completedCount: number;
  d: FormationData;
  setD: React.Dispatch<React.SetStateAction<FormationData>>;
  onClose: () => void;
  onCompleted: (id: string) => void;
  nextItem: FormationItem | null;
  onOpenNext: (id: string) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<'edit' | 'filing' | 'done'>('edit');
  const [applied, setApplied] = useState(false);
  const [n, setN] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The real write races the filing animation; "done" needs both. Tracked in
  // refs and resolved from the timer/promise callbacks (not effect bodies).
  const animDoneRef = useRef(false);
  const writeRef = useRef<'pending' | 'ok' | 'err'>('pending');
  const steps = fileSteps(item.kind, d);
  const set = <K extends keyof FormationData>(k: K, v: FormationData[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const finishIfReady = useCallback(() => {
    if (writeRef.current === 'err') {
      setPhase('edit');
      setSaveError('Could not save this step — check your connection and try again.');
      return;
    }
    if (animDoneRef.current && writeRef.current === 'ok') {
      setPhase('done');
      onCompleted(item.id);
    }
  }, [item.id, onCompleted]);

  function startFiling() {
    setSaveError(null);
    setN(0);
    animDoneRef.current = false;
    writeRef.current = 'pending';
    setPhase('filing');
    fileFormationStep(item.kind, d)
      .then((res) => {
        writeRef.current = res.ok ? 'ok' : 'err';
        finishIfReady();
      })
      .catch(() => {
        writeRef.current = 'err';
        finishIfReady();
      });
  }

  // Drive the filing animation; its completion is one arm of the race above.
  useEffect(() => {
    if (phase !== 'filing') return;
    if (reduced) {
      const t = setTimeout(() => {
        animDoneRef.current = true;
        finishIfReady();
      }, 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => {
          animDoneRef.current = true;
          finishIfReady();
        }, 500);
      }
    }, 620);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length, finishIfReady]);

  if (phase === 'done') {
    const rows = resultRows(item.kind, d);
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <div className="w-full text-center">
          <span className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
            <Check size={28} strokeWidth={2.2} aria-hidden />
          </span>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
            {item.name} — filed
          </h2>
          <p className="mt-1.5 text-[13px] text-fg-3">
            {completedCount} of {total} formation steps complete. Review what was produced, then
            continue — or go back and edit.
          </p>
        </div>

        <div className="mt-[18px] w-full overflow-hidden rounded-[14px] border border-hairline">
          <div className="flex items-center gap-2.5 border-b border-hairline bg-surface-1 px-[15px] py-2.5">
            <FileText size={15} className="text-gold-1" aria-hidden />
            <span className="text-[12.5px] font-semibold text-fg-1">{item.doc}</span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-success">
              <ShieldCheck size={12} aria-hidden />
              On the record
            </span>
          </div>
          {rows.map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                'flex gap-3.5 px-[15px] py-2.5',
                i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                i > 0 && 'border-t border-[var(--border-faint)]'
              )}
            >
              <span className="w-[150px] flex-none text-[12px] text-fg-4">{k}</span>
              <span className="text-[13px] font-medium text-fg-1">{v}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 flex items-center gap-2 text-[11.5px] text-fg-5">
          <Info size={12} aria-hidden />
          Earn drafted <span className="font-semibold text-fg-3">{item.doc}</span> from these.
          Nothing reaches an LP until you sign.
        </p>

        <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button
            variant="ghost"
            icon={Pencil}
            onClick={() => {
              setPhase('edit');
              setN(0);
            }}
          >
            Go back &amp; edit
          </Button>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="outline" icon={ListChecks} onClick={onClose}>
              Checklist
            </Button>
            {nextItem ? (
              <Button variant="gold" iconRight={ArrowRight} onClick={() => onOpenNext(nextItem.id)}>
                Continue: {nextItem.name.split(' (')[0]}
              </Button>
            ) : (
              <Button variant="gold" iconRight={Check} onClick={onClose}>
                See your formed fund
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'filing') {
    const pct = Math.round((n / steps.length) * 100);
    return (
      <div className="mx-auto flex w-full max-w-[540px] flex-col items-center py-6">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="relative mb-3">
            <span
              aria-hidden
              className="absolute -inset-2.5 rounded-full motion-safe:animate-pulse"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)',
                filter: 'blur(8px)'
              }}
            />
            <EarnCoin size={52} className="relative" />
          </div>
          <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
            Filing {item.doc}…
          </h2>
          <p className="mt-1.5 text-[12.5px] text-fg-3">
            You approved it — the team is executing. Nothing goes to an LP until you sign.
          </p>
        </div>
        <ProgressBar value={pct} height={6} label="Filing progress" className="w-full" />
        <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3">
          {steps.map((s, i) =>
            i <= n ? (
              <div key={s} className="flex items-center gap-2.5 px-2 py-2">
                <span
                  className={cn(
                    'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                    i < n
                      ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                      : 'border-hairline bg-surface-2 text-fg-4'
                  )}
                >
                  {i < n ? (
                    <Check size={12} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                  )}
                </span>
                <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>{s}</span>
              </div>
            ) : null
          )}
        </Card>
      </div>
    );
  }

  // edit
  const heading = STEP_HEADING[item.kind];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onClose}>
          Checklist
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{item.name}</h1>
          <p className="text-[12px] text-fg-4">
            Step {index + 1} of {total} · you make the calls, Earn advises
          </p>
        </div>
        <Badge tone="azure" dot>
          Copiloted
        </Badge>
      </div>
      <ProgressBar
        value={Math.round((completedCount / total) * 100)}
        height={4}
        tone="accent"
        label="Formation progress"
      />

      {saveError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
          <TriangleAlert size={15} aria-hidden />
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-6">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg-1">
            {heading.title}
          </h2>
          <p className="mb-4 mt-1.5 text-[12.5px] text-fg-4">{heading.blurb}</p>
          <StepEditor kind={item.kind} d={d} set={set} />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
            <Button
              variant="ghost"
              icon={Bookmark}
              onClick={() => {
                void saveFormationDraft(d);
                onClose();
              }}
            >
              Save &amp; close
            </Button>
            <Button variant="gold" iconRight={FileSignature} onClick={startFiling}>
              Complete &amp; file this step
            </Button>
          </div>
        </Card>

        <Card className="self-start p-[17px]">
          <div className="mb-3 flex items-center gap-2.5">
            <EarnCoin size={32} online className="flex-none" />
            <div>
              <div className="text-[13px] font-semibold text-fg-1">Earn</div>
              <div className="text-[10.5px] text-fg-4">Your formation copilot</div>
            </div>
          </div>
          <Eyebrow className="mb-1.5 text-gold-1">Earn recommends</Eyebrow>
          <p className="text-[12.5px] leading-relaxed text-fg-2">{F_REC_TEXT[item.kind]}</p>
          <Button
            variant={applied ? 'secondary' : 'gold'}
            size="sm"
            icon={applied ? Check : Sparkles}
            className="mt-3.5 w-full"
            onClick={() => {
              for (const [k, v] of Object.entries(F_REC[item.kind])) {
                set(k as keyof FormationData, v as never);
              }
              setApplied(true);
            }}
          >
            {applied ? 'Recommendation applied' : "Apply Earn's recommendation"}
          </Button>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-5">
            <Hand size={12} aria-hidden />
            You&apos;re in control — change anything.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ── the formed-fund payoff ──────────────────────────────────────────────── */

const COMPLETE_TONE: Record<string, { bg: string; color: string; line: string }> = {
  gold: { bg: 'var(--gold-soft)', color: 'var(--gold-1)', line: 'var(--gold-line)' },
  azure: { bg: 'var(--accent-soft)', color: 'var(--accent)', line: 'var(--accent-line)' },
  success: { bg: 'var(--success-soft)', color: 'var(--success)', line: 'var(--success-line)' }
};

function FormationComplete({
  firm,
  sizeLabel,
  d,
  onReview
}: {
  firm: string;
  sizeLabel: string;
  d: FormationData;
  onReview: () => void;
}) {
  const entity = d.entity === 'Undecided' ? 'Delaware LP' : d.entity;
  const exemption = d.exemption === 'Undecided' ? 'Rule 506(b)' : d.exemption;
  const fundId = fundIdFor(firm);
  const formedOn = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const onRecord = [
    { name: 'Fund narrative', sub: 'Your positioning, origin & edge', layer: 'Truth' },
    { name: 'Certificate of Formation', sub: `${entity} · ${d.domicile}`, layer: 'Truth' },
    {
      name: 'Limited Partnership Agreement',
      sub: `${d.fee}% fee · ${d.carry}% carry · ${d.hurdle}% pref`,
      layer: 'Concept'
    },
    {
      name: 'Private Placement Memorandum',
      sub: 'Offering terms & risk factors',
      layer: 'Concept'
    },
    {
      name: 'Subscription documents',
      sub: `${d.minCommit} minimum · ${exemption}`,
      layer: 'Execution'
    },
    { name: 'Form D', sub: `${exemption} · prepared for filing`, layer: 'Execution' },
    { name: 'Bank & escrow accounts', sub: `${d.bank} · capital-call ready`, layer: 'Work' }
  ];

  const unlocks = [
    {
      icon: Landmark,
      tone: 'gold',
      title: 'Open your raise',
      sub: `Your ${sizeLabel} vehicle can now accept commitments. Sloane's LP list is ready.`,
      href: '/source',
      cta: 'Start the raise',
      primary: true
    },
    {
      icon: FolderOpen,
      tone: 'azure',
      title: 'Share your data room',
      sub: 'Every document lands in one secure, trackable room for LP diligence.',
      href: '/build'
    },
    {
      icon: GraduationCap,
      tone: 'success',
      title: 'Onboard LPs',
      sub: 'Send subscription packs and drive each commitment to a signed close.',
      href: '/execute'
    }
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="relative overflow-hidden border-[var(--gold-line)] p-6 shadow-[0_0_0_1px_var(--gold-line),var(--shadow-lg)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(60% 90% at 88% 0%, rgba(247,201,72,0.13), transparent 70%)'
          }}
        />
        <div className="relative flex items-center gap-4">
          <EarnCoin size={54} glow className="flex-none" />
          <div className="min-w-0 flex-1">
            <Badge tone="success" className="mb-2">
              Formation complete
            </Badge>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg-1">
              {firm} is formed.
            </h1>
            <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-relaxed text-fg-3">
              Your vehicle legally exists and every document is on the record. You set the direction
              — the team filed it. Now you can raise.
            </p>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 overflow-hidden rounded-[13px] border border-hairline sm:grid-cols-4">
          {(
            [
              ['Entity', entity, false],
              ['Domicile', d.domicile, false],
              ['Fund ID', fundId, true],
              ['Formed', formedOn, false]
            ] as [string, string, boolean][]
          ).map(([k, v, mono], i) => (
            <div
              key={k}
              className={cn(
                'bg-surface-1 px-[15px] py-3',
                i > 0 && 'sm:border-l sm:border-[var(--border-faint)]'
              )}
            >
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-fg-5">{k}</div>
              <div
                className={cn(
                  'mt-1 text-[13.5px] font-semibold',
                  mono ? 'font-mono text-gold-1' : 'text-fg-1'
                )}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-[18px]">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <Eyebrow>7 documents · logged to your Chain of Trust</Eyebrow>
            <div className="mt-0.5 text-[14.5px] font-semibold text-fg-1">On the record</div>
          </div>
          <Button variant="ghost" size="sm" icon={FolderOpen} onClick={onReview}>
            Review documents
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {onRecord.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-[13px] py-2.5"
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
                <Check size={15} strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-fg-1">{r.name}</div>
                <div className="truncate text-[10.5px] text-fg-5">{r.sub}</div>
              </div>
              <span className="flex-none text-[9.5px] font-semibold uppercase tracking-[0.04em] text-fg-4">
                {r.layer}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-[18px]">
        <Eyebrow>Your fund is investable — next in your lifecycle</Eyebrow>
        <h2 className="mb-3.5 mt-0.5 text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
          What this unlocks
        </h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {unlocks.map((u) => {
            const t = COMPLETE_TONE[u.tone];
            const Ico = u.icon;
            return (
              <div
                key={u.title}
                className={cn(
                  'flex flex-col rounded-[13px] border p-[15px]',
                  u.primary
                    ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                    : 'border-hairline bg-surface-1'
                )}
              >
                <span
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border"
                  style={{ background: t.bg, color: t.color, borderColor: t.line }}
                >
                  <Ico size={17} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="mt-2.5 text-[13.5px] font-semibold text-fg-1">{u.title}</div>
                <p className="mt-1 flex-1 text-[11.5px] leading-relaxed text-fg-4">{u.sub}</p>
                <Link
                  href={u.href}
                  className={cn(
                    'mt-3 inline-flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
                    u.primary
                      ? 'bg-gradient-to-br from-gold-1 to-gold-2 text-[#070b14] hover:brightness-105'
                      : 'border border-hairline text-fg-2 hover:bg-surface-2'
                  )}
                >
                  {u.primary ? u.cta : 'Open'}
                  <ArrowRight size={13} strokeWidth={2} aria-hidden />
                </Link>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="flex flex-wrap items-center gap-3 p-[14px] px-[18px]">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3">
          <CheckCircle2 size={15} className="text-success" aria-hidden />
          Build complete
        </span>
        <ArrowRight size={14} className="text-fg-5" aria-hidden />
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gold-1">
          <span
            className="h-1.5 w-1.5 rounded-full bg-gold-1 motion-safe:animate-pulse"
            aria-hidden
          />
          Source — your raise begins
        </span>
        <span className="flex-1" />
        <Link
          href="/source"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
        >
          Go to your raise
          <ArrowRight size={14} strokeWidth={1.9} aria-hidden />
        </Link>
      </Card>
    </div>
  );
}

/* ── the flow orchestrator ───────────────────────────────────────────────── */

export interface FormationFlowProps {
  /** The fund/firm name, from the live mandate/profile. */
  firm: string;
  /** Target-raise label for the "formed" payoff (e.g. "$500M"). */
  sizeLabel: string;
  /** Persisted working document, from `getFormationState`. */
  initialData: FormationData;
  /** Item ids already filed, from `getFormationState`. */
  initialCompleted: string[];
}

export function FormationFlow({
  firm,
  sizeLabel,
  initialData,
  initialCompleted
}: FormationFlowProps) {
  const total = FORMATION_ITEMS.length;
  const items = FORMATION_ITEMS;
  const [view, setView] = useState<'story' | 'checklist' | 'item' | 'complete'>(
    initialCompleted.length >= total
      ? 'complete'
      : initialCompleted.length > 0
        ? 'checklist'
        : 'story'
  );
  const [d, setD] = useState<FormationData>(initialData);
  const [completed, setCompleted] = useState<string[]>(initialCompleted);
  const [activeId, setActiveId] = useState<string | null>(null);

  const completedCount = completed.length;
  const allDone = completedCount >= total;

  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null;
  const nextItem = items.slice(activeIndex + 1).find((i) => !completed.includes(i.id)) ?? null;

  function openItem(id: string) {
    setActiveId(id);
    setView('item');
  }

  function onCompleted(id: string) {
    setCompleted((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function backToChecklist() {
    if (completed.length >= total) setView('complete');
    else setView('checklist');
  }

  if (view === 'story') {
    return <FormationStory firm={firm} onBegin={() => setView('checklist')} />;
  }

  if (view === 'item' && activeItem) {
    return (
      <FormationStep
        item={activeItem}
        index={activeIndex}
        total={total}
        completedCount={completedCount}
        d={d}
        setD={setD}
        onClose={backToChecklist}
        onCompleted={onCompleted}
        nextItem={nextItem}
        onOpenNext={openItem}
      />
    );
  }

  if (view === 'complete' || (view === 'checklist' && allDone)) {
    return (
      <FormationComplete
        firm={firm}
        sizeLabel={sizeLabel}
        d={d}
        onReview={() => setView('checklist')}
      />
    );
  }

  // checklist
  const firstOpenId = items.find((i) => !completed.includes(i.id))?.id ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
          aria-hidden
        >
          <Landmark size={21} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow>Formation · {firm}</Eyebrow>
          <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
            Form your fund
          </h1>
        </div>
        <Badge tone="warning" className="text-[10px]">
          Illustrative
        </Badge>
        {firstOpenId && (
          <Button
            variant="gold"
            size="sm"
            iconRight={ArrowRight}
            onClick={() => openItem(firstOpenId)}
          >
            {completedCount === 0 ? 'Start formation' : 'Continue formation'}
          </Button>
        )}
      </div>

      <ProgressBar
        value={Math.round((completedCount / total) * 100)}
        height={6}
        label="Formation progress"
      />

      <p className="flex items-center gap-2 text-[12px] text-fg-4">
        <Info size={13} className="flex-none text-gold-1" aria-hidden />
        Each step is copiloted — you decide, Earn drafts. Stop and pick back up anytime.
      </p>

      <Card className="flex flex-col gap-1.5 p-3">
        {items.map((item, i) => {
          const done = completed.includes(item.id);
          const isNext = item.id === firstOpenId;
          const Ico = done ? CheckCircle2 : isNext ? Sparkles : FileText;
          const undec = itemUndecided(item.kind, d);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openItem(item.id)}
              className={cn(
                'flex items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left transition',
                isNext
                  ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                  : 'border-hairline bg-surface-1 hover:bg-surface-2'
              )}
            >
              <span className="font-mono text-[11px] tabular-nums text-fg-5">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={cn(
                  'flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border',
                  done
                    ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                    : 'border-hairline bg-surface-2 text-fg-3'
                )}
              >
                <Ico size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-fg-1">{item.name}</span>
                <span className="block text-[11px] text-fg-5">
                  {item.who} · {item.doc}
                </span>
              </span>
              {done ? (
                <Badge tone="success" className="text-[10px]">
                  Filed
                </Badge>
              ) : undec > 0 ? (
                <Badge tone="warning" className="text-[10px]">
                  {undec} for Earn
                </Badge>
              ) : isNext ? (
                <Badge tone="gold" dot className="text-[10px]">
                  Next
                </Badge>
              ) : null}
              <ArrowRight size={14} className="flex-none text-fg-5" aria-hidden />
            </button>
          );
        })}
      </Card>

      {allDone && (
        <Button
          variant="gold"
          iconRight={ArrowRight}
          className="self-end"
          onClick={() => setView('complete')}
        >
          See your formed fund
        </Button>
      )}
    </div>
  );
}

/* ── the narrative opener ────────────────────────────────────────────────── */

function FormationStory({ firm, onBegin }: { firm: string; onBegin: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="relative overflow-hidden p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(54% 80% at 84% 0%, rgba(247,201,72,0.10), transparent 70%)'
          }}
        />
        <div className="relative max-w-[64ch]">
          <div className="mb-4 flex items-center gap-2.5">
            <EarnCoin size={30} className="flex-none" />
            <Eyebrow className="text-gold-1">Forming {firm}</Eyebrow>
          </div>
          <h1 className="text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] text-fg-1">
            This is where your fund becomes real.
          </h1>
          <p className="mt-3.5 text-[14.5px] leading-relaxed text-fg-3">
            Right now {firm} is an idea and a mandate. Over seven steps it becomes a legal vehicle
            that can hold capital, sign deals, and accept investors. You make the decisions that
            define it —{' '}
            <span className="font-semibold text-fg-2">
              Earn drafts every document, explains each choice, and files nothing without your
              sign-off.
            </span>
          </p>
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-2.5">
            <GraduationCap size={16} className="flex-none text-gold-1" aria-hidden />
            <span className="text-[12.5px] text-fg-2">
              No legal background needed. Unsure on any step? Choose{' '}
              <span className="font-semibold">&ldquo;Not sure yet&rdquo;</span> and Earn decides it
              for you, then flags it for review.
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-[18px]">
        <div className="mb-1 flex items-center gap-2">
          <Route size={14} className="text-fg-4" aria-hidden />
          <Eyebrow>The path to a formed fund · seven steps</Eyebrow>
        </div>
        <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
          What we&rsquo;ll do together
        </h2>
        <div className="mt-2 flex flex-col">
          {FORMATION_ARC.map((s, i) => {
            const Ico = iconFor(s.icon);
            return (
              <div
                key={s.n}
                className={cn(
                  'flex items-start gap-3.5 py-3',
                  i > 0 && 'border-t border-[var(--border-faint)]'
                )}
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-2 text-fg-3">
                  <Ico size={17} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-gold-1">{s.n}</span>
                    <span className="text-[14px] font-semibold text-fg-1">{s.lead}</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] leading-relaxed text-fg-4">{s.text}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="gold" size="lg" iconRight={ArrowRight} onClick={onBegin}>
            Begin formation
          </Button>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-5">
            <Clock size={13} aria-hidden />
            About 10 minutes · stop and resume anytime
          </span>
        </div>
      </Card>
    </div>
  );
}

export default FormationFlow;
