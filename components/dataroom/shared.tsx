'use client';

import { type ReactNode } from 'react';
import {
  Calculator,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FilePlus,
  FileText,
  Link2,
  Mail,
  Presentation,
  TrendingUp,
  type LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * components/dataroom/shared.tsx — the small primitives the Materials & Data
 * Room surfaces share: the config's icon-name resolver, relative time for the
 * activity feed, and the chip/eyebrow/panel-header trio.
 */

const ICONS: Record<string, LucideIcon> = {
  presentation: Presentation,
  'file-text': FileText,
  'clipboard-list': ClipboardList,
  'trending-up': TrendingUp,
  calculator: Calculator,
  mail: Mail,
  eye: Eye,
  download: Download,
  'share-2': Link2,
  link: Link2,
  'shield-check': CheckCircle2,
  'file-plus': FilePlus
};
export function icon(name: string): LucideIcon {
  return ICONS[name] ?? FileText;
}

/** Compact relative time for the activity feed ("just now", "2h ago"…). */
export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'Just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function Chip({
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

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  icon: Ico,
  title,
  eyebrow,
  action
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Ico size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div>
          <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
        </div>
      </div>
      {action}
    </div>
  );
}
