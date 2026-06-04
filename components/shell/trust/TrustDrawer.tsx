'use client';

import { useEffect } from 'react';
import {
  ShieldCheck,
  Upload,
  CircleCheck,
  Circle,
  Loader,
  Lock,
  Sparkles,
  UserCheck,
  Paperclip,
  X,
  type LucideIcon
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { TRUST_LAYERS, type TrustLayerMeta } from './trust-layers';

/** The entity a Chain-of-Trust drawer is currently inspecting. */
export interface TrustDrawerSubject {
  entity: string;
  stage: string;
  /** Rolled-up weighted verification percentage. */
  pct: number;
  summary: string;
}

const DEFAULT_SUBJECT: TrustDrawerSubject = {
  entity: 'Atlas Manufacturing',
  stage: 'M&A · Closing',
  pct: 51,
  summary: '$32M · 4-layer verification pipeline · from Cedar · DL-220 · last activity 2h ago'
};

interface ChecklistRow {
  label: string;
  state: 'done' | 'open';
  attach?: boolean;
}

const REQUIRED_DOCS: ChecklistRow[] = [
  { label: 'Investment thesis memo', state: 'done', attach: true },
  { label: 'Market sizing (TAM)', state: 'done', attach: true },
  { label: 'Competitive map', state: 'open' }
];

const REQUIRED_TASKS: ChecklistRow[] = [
  { label: 'Validate thesis vs LP appetite', state: 'done' },
  { label: 'Complete competitive mapping', state: 'open' }
];

interface ActivityRow {
  time: string;
  text: string;
  layer: TrustLayerMeta['layer'];
}

const ACTIVITY: ActivityRow[] = [
  { time: '2h ago', text: 'Market sizing (TAM) verified by Earn', layer: 'concept' },
  {
    time: '5h ago',
    text: 'Investment thesis memo uploaded — Proof of Truth complete',
    layer: 'truth'
  },
  { time: 'Yesterday', text: 'Thesis validated against 3 of 4 LP mandates', layer: 'concept' },
  { time: '2 days ago', text: 'Source data ingested from Cedar (DL-220)', layer: 'truth' }
];

function layerStateIcon(pct: number): { Icon: LucideIcon; spin?: boolean } {
  if (pct >= 100) return { Icon: CircleCheck };
  if (pct <= 0) return { Icon: Lock };
  return { Icon: Loader, spin: true };
}

function LayerCard({ meta, index }: { meta: TrustLayerMeta; index: number }) {
  const { Icon: StateIcon, spin } = layerStateIcon(meta.pct);
  const LayerIcon = meta.icon;
  return (
    <div
      className="relative flex min-w-[150px] flex-1 flex-col gap-2 rounded-2xl border bg-surface-1 p-3.5"
      style={{ borderColor: meta.line }}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl"
          style={{ background: meta.soft, color: meta.color }}
        >
          <LayerIcon size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-fg-5">0{index + 1}</span>
      </div>
      <div className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg-1">{meta.name}</div>
      <div className="text-[11px] leading-snug text-fg-4">{meta.desc}</div>
      <div className="mt-1 flex items-center justify-between">
        <span
          className="text-[17px] font-semibold tabular-nums tracking-[-0.01em]"
          style={{ color: meta.color }}
        >
          {meta.pct}%
        </span>
        <StateIcon
          size={15}
          strokeWidth={1.9}
          className={cn('text-fg-4', spin && 'animate-spin')}
          style={meta.pct >= 100 ? { color: meta.color } : undefined}
          aria-hidden
        />
      </div>
    </div>
  );
}

function ChecklistGroup({
  title,
  rows,
  action
}: {
  title: string;
  rows: ChecklistRow[];
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-fg-1">{title}</div>
        {action}
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const Icon = row.state === 'done' ? CircleCheck : Circle;
          return (
            <li key={row.label} className="flex items-center gap-2.5">
              <Icon
                size={16}
                strokeWidth={1.9}
                className={row.state === 'done' ? 'text-success' : 'text-fg-5'}
                aria-hidden
              />
              <span
                className={cn(
                  'flex-1 text-[12.5px]',
                  row.state === 'done' ? 'text-fg-2' : 'text-fg-4'
                )}
              >
                {row.label}
              </span>
              {row.attach && (
                <Paperclip size={13} strokeWidth={1.9} className="text-fg-5" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface TrustDrawerProps {
  open: boolean;
  onClose: () => void;
  subject?: TrustDrawerSubject;
}

/**
 * TrustDrawer — the right slide-over that opens when a Chain-of-Trust toast is
 * clicked. Presentational: shows the 4-layer proof pipeline with progress, the
 * required docs/tasks, AI validation, human approval and a timestamped activity
 * log. Slides via transform only (never transitions `color`).
 */
export function TrustDrawer({ open, onClose, subject = DEFAULT_SUBJECT }: TrustDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[70] bg-black/50 backdrop-blur-[1px] transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Chain of Trust detail"
        className={cn(
          'fixed right-0 top-0 z-[80] flex h-full w-full max-w-[620px] flex-col border-l border-hairline bg-bg-1 shadow-[var(--shadow-lg)] transition-transform duration-300 ease-[cubic-bezier(.22,.61,.36,1)] will-change-transform',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
          <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-2">
            <ShieldCheck size={19} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Chain of Trust
            </div>
            <div className="flex items-center gap-2">
              <span className="truncate text-lg font-semibold tracking-[-0.015em] text-fg-1">
                {subject.entity}
              </span>
              <Badge tone="success" className="px-2 py-0.5 text-[10.5px]">
                {subject.stage}
              </Badge>
            </div>
          </div>
          <div className="flex flex-none flex-col items-end">
            <span className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
              {subject.pct}%
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-success">
              Verified
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
          >
            <X size={16} strokeWidth={1.9} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-[12px] text-fg-4">{subject.summary}</p>

          {/* Pipeline progress strip */}
          <div className="flex gap-1.5">
            {TRUST_LAYERS.map((meta) => (
              <div
                key={meta.layer}
                className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]"
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${meta.pct}%`, background: meta.color }}
                />
              </div>
            ))}
          </div>

          {/* 4-layer pipeline */}
          <div className="flex flex-wrap gap-2.5">
            {TRUST_LAYERS.map((meta, i) => (
              <LayerCard key={meta.layer} meta={meta} index={i} />
            ))}
          </div>

          <ChecklistGroup
            title="Required documents"
            rows={REQUIRED_DOCS}
            action={
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2.5 py-1 text-[11.5px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <Upload size={13} strokeWidth={1.9} aria-hidden />
                Upload
              </button>
            }
          />

          <ChecklistGroup title="Required tasks" rows={REQUIRED_TASKS} />

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Human approval */}
            <section className="rounded-2xl border border-hairline bg-surface-1 p-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg-1">
                <UserCheck size={16} strokeWidth={1.9} className="text-fg-3" aria-hidden />
                Human approval
              </div>
              <Badge tone="warning" className="px-2 py-0.5 text-[11px]">
                Pending review
              </Badge>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg-4">
                Awaiting partner sign-off before the Execution layer advances.
              </p>
            </section>

            {/* AI validation */}
            <section
              className="rounded-2xl border p-4"
              style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}
            >
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg-1">
                <Sparkles size={16} strokeWidth={1.9} className="text-accent" aria-hidden />
                AI validation
              </div>
              <p className="text-[11.5px] leading-relaxed text-fg-2">
                Thesis aligns with 3 of 4 LP mandates. Competitive map incomplete — add 2 incumbents
                to close Proof of Concept.
              </p>
            </section>
          </div>

          {/* Activity */}
          <section className="rounded-2xl border border-hairline bg-surface-1 p-4">
            <div className="mb-3 text-[13px] font-semibold text-fg-1">Activity</div>
            <ol className="flex flex-col gap-3">
              {ACTIVITY.map((row, i) => {
                const meta = TRUST_LAYERS.find((l) => l.layer === row.layer) ?? TRUST_LAYERS[0];
                return (
                  <li key={i} className="flex gap-3">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                      style={{ background: meta.color }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-fg-2">{row.text}</div>
                      <div className="font-mono text-[10.5px] tabular-nums text-fg-5">
                        {row.time}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </aside>
    </>
  );
}
