'use client';

import { createElement, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderLock,
  Hand,
  Loader2,
  Sparkles,
  TriangleAlert
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { buildMaterial } from '@/lib/dataroom/actions';
import {
  MATERIAL_BUILD,
  MAT_LABEL,
  MAT_META,
  buildSteps,
  materialDefaults,
  materialRows,
  type MaterialBuildCfg,
  type MaterialValue
} from '@/lib/dataroom/config';
import { cn } from '@/lib/utils';
import { Chip, Eyebrow, icon } from './shared';

/* ── the copiloted material builder ──────────────────────────────────────── */

export function MaterialBuilder({
  id,
  initialSpec,
  alreadyReady,
  onBack,
  onBuilt
}: {
  id: string;
  /** Persisted spec when re-opening a built material. */
  initialSpec: Record<string, MaterialValue> | null;
  alreadyReady: boolean;
  onBack: () => void;
  onBuilt: (id: string, spec: Record<string, MaterialValue>) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const cfg: MaterialBuildCfg = MATERIAL_BUILD[id];
  const meta = MAT_META[id];
  const label = MAT_LABEL[id];
  const [d, setD] = useState<Record<string, MaterialValue>>(
    () => initialSpec ?? materialDefaults(cfg)
  );
  const [applied, setApplied] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'building' | 'done'>(alreadyReady ? 'done' : 'edit');
  const [n, setN] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const steps = buildSteps(id);

  // Any manual edit means the spec no longer matches Earn's recommendation, so
  // the "Recommendation applied" state must clear.
  const set = (k: string, v: MaterialValue) => {
    setApplied(false);
    setD((p) => ({ ...p, [k]: v }));
  };
  const toggle = (k: string, v: string) => {
    setApplied(false);
    setD((p) => {
      const cur = (p[k] as string[]) ?? [];
      return { ...p, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
  };

  useEffect(() => {
    if (phase !== 'building') return;
    if (reduced) {
      const t = setTimeout(() => setPhase('done'), 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => setPhase('done'), 450);
      }
    }, 600);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length]);

  async function addToRoom() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await buildMaterial(id, d);
      if (res.ok) onBuilt(id, d);
      else setSaveError(res.error);
    } catch {
      setSaveError('Could not save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
          {label} — {alreadyReady ? 'in the room' : 'ready'}
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          {alreadyReady
            ? `Live in ${meta.folder}. Adjust the spec and rebuild anytime.`
            : `Built to your spec for ${meta.folder}. Add it to the room, or go back and adjust.`}
        </p>
        <div className="mt-4 w-full overflow-hidden rounded-[14px] border border-hairline">
          <div className="flex items-center gap-2.5 border-b border-hairline bg-surface-1 px-[15px] py-2.5">
            {createElement(icon(meta.icon), {
              size: 15,
              className: 'text-gold-1',
              'aria-hidden': true
            })}
            <span className="text-[12.5px] font-semibold text-fg-1">{label}</span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-success">
              <FolderLock size={12} aria-hidden />
              {meta.folder}
            </span>
          </div>
          {materialRows(cfg, d).map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                'flex gap-3.5 px-[15px] py-2.5',
                i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                i > 0 && 'border-t border-[var(--border-faint)]'
              )}
            >
              <span className="w-[130px] flex-none text-[12px] text-fg-4">{k}</span>
              <span className="text-[13px] font-medium text-fg-1">{v}</span>
            </div>
          ))}
        </div>
        {saveError && (
          <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={15} aria-hidden />
            {saveError}
          </div>
        )}
        <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={() => {
              setPhase('edit');
              setN(0);
            }}
          >
            Go back &amp; edit
          </Button>
          {alreadyReady ? (
            <div className="flex items-center gap-2.5">
              <Button
                variant="gold"
                icon={saving ? Loader2 : undefined}
                iconRight={saving ? undefined : Check}
                disabled={saving}
                onClick={() => void addToRoom()}
              >
                {saving ? 'Saving…' : 'Save & rebuild'}
              </Button>
              <Button variant="outline" onClick={onBack}>
                Close
              </Button>
            </div>
          ) : (
            <Button
              variant="gold"
              icon={saving ? Loader2 : undefined}
              iconRight={saving ? undefined : ArrowRight}
              disabled={saving}
              onClick={() => void addToRoom()}
            >
              {saving ? 'Adding…' : 'Add to room & continue'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'building') {
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
            Building {label}…
          </h2>
          <p className="mt-1.5 text-[12.5px] text-fg-3">
            Drafting from your fund story to the spec you set.
          </p>
        </div>
        <ProgressBar value={pct} height={6} label="Build progress" className="w-full" />
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onBack}>
          Materials
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{label}</h1>
          <p className="text-[12px] text-fg-4">
            You shape it, Earn drafts it · lands in {meta.folder}
          </p>
        </div>
        <Badge tone="azure" dot>
          Copiloted
        </Badge>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-6">
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-4">{cfg.intro}</p>
          <div className="flex flex-col gap-5">
            {cfg.decisions.map((dec) => (
              <div key={dec.key}>
                <Eyebrow className="mb-2">
                  {dec.label}
                  {dec.kind === 'multi' && (
                    <span className="font-normal normal-case tracking-normal text-fg-5">
                      {' '}
                      · pick any
                    </span>
                  )}
                </Eyebrow>
                <div className="flex flex-wrap gap-2">
                  {dec.opts.map((o) => (
                    <Chip
                      key={o}
                      label={o}
                      selected={
                        dec.kind === 'multi'
                          ? ((d[dec.key] as string[]) ?? []).includes(o)
                          : d[dec.key] === o
                      }
                      onClick={() => (dec.kind === 'multi' ? toggle(dec.key, o) : set(dec.key, o))}
                    />
                  ))}
                </div>
              </div>
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
                setN(0);
                setPhase('building');
              }}
            >
              Build &amp; add to room
            </Button>
          </div>
        </Card>
        <Card className="self-start p-[17px]">
          <div className="mb-3 flex items-center gap-2.5">
            <EarnCoin size={32} online className="flex-none" />
            <div>
              <div className="text-[13px] font-semibold text-fg-1">Earn</div>
              <div className="text-[10.5px] text-fg-4">{meta.cat} copilot</div>
            </div>
          </div>
          <Eyebrow className="mb-1.5 text-gold-1">Earn recommends</Eyebrow>
          <p className="text-[12.5px] leading-relaxed text-fg-2">{cfg.recText}</p>
          <Button
            variant={applied ? 'secondary' : 'gold'}
            size="sm"
            icon={applied ? Check : Sparkles}
            className="mt-3.5 w-full"
            onClick={() => {
              setD(materialDefaults(cfg));
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
