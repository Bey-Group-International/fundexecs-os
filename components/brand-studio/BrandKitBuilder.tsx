'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  Hexagon,
  Loader2,
  Pencil,
  Quote,
  Sparkles,
  TriangleAlert
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';
import { publishBrandAsset } from '@/lib/brand-studio/actions';
import {
  BK_LOGOS,
  BK_REC,
  BK_TAGLINES,
  BK_TYPES,
  BK_VOICES,
  PALETTES,
  brandKitAesthetic,
  paletteFor,
  typeFor,
  type BrandKitSpec
} from '@/lib/brand-studio/config';
import { cn } from '@/lib/utils';
import { BuilderHeader, BuildingScreen, EarnAside, useBuildSequence } from './builder-kit';

const STEPS = [
  'Read your fund story & posture',
  'Generate wordmark & palette',
  'Set type & voice',
  'Publish your brand kit'
];

type KitDraft = Omit<BrandKitSpec, 'aesthetic'>;

function Mark({ d, firm, size = 30 }: { d: KitDraft; firm: string; size?: number }) {
  const pal = paletteFor(d.palette);
  const initials = (firm || 'Cedar Lane')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  if (d.logo === 'Coin') return <EarnCoin size={size} />;
  if (d.logo === 'Symbol')
    return (
      <span
        className="inline-flex flex-none items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          background: pal[2],
          color: pal[0]
        }}
      >
        <Hexagon size={size * 0.6} aria-hidden />
      </span>
    );
  return (
    <span
      className="inline-flex flex-none items-center justify-center font-bold tracking-[-0.02em]"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: pal[2],
        color: pal[0],
        fontSize: size * 0.42
      }}
    >
      {initials}
    </span>
  );
}

/** The live brand board — gradient banner, swatch strip, type specimen. */
function BrandBoard({ d, firm }: { d: KitDraft; firm: string }) {
  const pal = paletteFor(d.palette);
  const typ = typeFor(d.type);
  return (
    <div className="overflow-hidden rounded-[14px] border border-hairline">
      <div
        className="px-5 py-[26px] text-center"
        style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }}
      >
        <div className="flex items-center justify-center gap-2.5">
          <Mark d={d} firm={firm} size={32} />
          <span
            className="text-[23px] tracking-[-0.02em] text-white"
            style={{ fontFamily: typ.stack, fontWeight: typ.weight }}
          >
            {firm}
          </span>
        </div>
        <div className="mt-2 text-[12.5px]" style={{ color: pal[2], fontFamily: typ.stack }}>
          {d.tagline || BK_TAGLINES[0]}
        </div>
      </div>
      <div className="flex items-stretch bg-surface-1">
        {pal.map((c) => (
          <div key={c} className="h-[30px] flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-3.5 bg-surface-1 px-[15px] py-3">
        <span
          className="text-[18px] text-fg-1"
          style={{ fontFamily: typ.stack, fontWeight: typ.weight }}
        >
          Aa
        </span>
        <span className="text-[11px] text-fg-5">
          {d.type} · {d.voice} voice
        </span>
      </div>
    </div>
  );
}

/**
 * The prototype's dedicated brand-kit builder: tagline, logo mark, palette,
 * typeface and voice — with the brand board previewing live.
 */
export function BrandKitBuilder({
  firm,
  initial,
  alreadyLive,
  startProduced,
  onBack,
  onProduced,
  onPublished
}: {
  firm: string;
  initial: BrandKitSpec | null;
  alreadyLive: boolean;
  startProduced: boolean;
  onBack: () => void;
  onProduced: (spec: BrandKitSpec) => void;
  onPublished: (spec: BrandKitSpec) => void;
}) {
  const [d, setD] = useState<KitDraft>(() => ({
    tagline: '',
    logo: 'Monogram',
    palette: 'Navy & gold',
    type: 'Geist · modern',
    voice: 'Measured',
    ...(initial ?? {})
  }));
  const [applied, setApplied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const { phase, n, begin, backToEdit } = useBuildSequence(
    STEPS.length,
    alreadyLive || startProduced
  );

  const set = (k: keyof KitDraft, v: string) => setD((p) => ({ ...p, [k]: v }));
  const spec = (): BrandKitSpec => ({ ...d, aesthetic: brandKitAesthetic(d.voice) });

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const out = spec();
      const res = await publishBrandAsset('brandkit', out);
      if (res.ok) onPublished(out);
      else setPublishError(res.error);
    } catch {
      setPublishError('Could not publish — check your connection and try again.');
    } finally {
      setPublishing(false);
    }
  }

  if (phase === 'building')
    return <BuildingScreen heading="Designing your brand kit…" steps={STEPS} n={n} />;

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
          Brand kit — {alreadyLive ? 'live' : 'designed'}
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          {alreadyLive
            ? 'Applied across your deck, one-pager, website and data room automatically.'
            : 'Designed to your posture — publish to apply it across deck, one-pager, website and data room.'}
        </p>
        <div className="mt-4 w-full">
          <BrandBoard d={d} firm={firm} />
        </div>
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
        title="Brand kit"
        sub="You set the direction, Earn designs it — preview updates live"
        onBack={onBack}
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <Field
            label="Tagline"
            icon={Quote}
            value={d.tagline}
            onChange={(v) => set('tagline', v)}
            placeholder={BK_TAGLINES[0]}
            hint="Leave blank and Earn writes it from your thesis."
          />
          <Eyebrow className="mb-2 mt-5">Logo mark</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {BK_LOGOS.map((o) => (
              <Chip key={o} label={o} selected={d.logo === o} onClick={() => set('logo', o)} />
            ))}
          </div>
          <Eyebrow className="mb-2 mt-5">Palette</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {Object.keys(PALETTES).map((p) => {
              const on = d.palette === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('palette', p)}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-[7px] transition',
                    on
                      ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                      : 'border-hairline bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <span className="flex">
                    {PALETTES[p].map((c) => (
                      <span
                        key={c}
                        className="-ml-1 h-3.5 w-3.5 rounded border border-bg-1 first:ml-0"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  <span className={cn('text-[12px] font-medium', on ? 'text-fg-1' : 'text-fg-3')}>
                    {p}
                  </span>
                </button>
              );
            })}
          </div>
          <Eyebrow className="mb-2 mt-5">Typeface</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {Object.keys(BK_TYPES).map((o) => (
              <Chip key={o} label={o} selected={d.type === o} onClick={() => set('type', o)} />
            ))}
          </div>
          <Eyebrow className="mb-2 mt-5">Voice</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {BK_VOICES.map((o) => (
              <Chip key={o} label={o} selected={d.voice === o} onClick={() => set('voice', o)} />
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
              Design &amp; publish
            </Button>
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-[17px]">
            <Eyebrow className="mb-2.5 flex items-center gap-1.5">
              <Eye size={12} className="text-gold-1" aria-hidden />
              Live brand board
            </Eyebrow>
            <BrandBoard d={d} firm={firm} />
          </Card>
          <EarnAside
            copilotSub="Brand copilot"
            note="Institutional navy & gold with a measured voice reads as serious capital — the register LPs trust. Leave the tagline blank and I'll write it from your thesis."
            applied={applied}
            onApply={() => {
              setD((p) => ({ ...p, ...BK_REC }));
              setApplied(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
