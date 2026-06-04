'use client';

import { useState } from 'react';
import {
  X,
  ListChecks,
  FileSearch,
  Mail,
  Mic,
  ClipboardCheck,
  ArrowUpRight,
  type LucideIcon
} from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { BRAINS } from '@/components/screens/brains';
import { EarnChat } from '@/app/ask-earn/EarnChat';
import { cn } from '@/lib/utils';

interface RecommendedAction {
  label: string;
  icon: LucideIcon;
}

const RECOMMENDED: RecommendedAction[] = [
  { label: 'Build LP list', icon: ListChecks },
  { label: 'Review deck like an institutional LP', icon: FileSearch },
  { label: 'Generate investor outreach', icon: Mail },
  { label: 'Summarize last meeting', icon: Mic },
  { label: 'Create diligence checklist', icon: ClipboardCheck }
];

function PresenceHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
      <EarnCoin size={36} online glow className="flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
          Earn Copilot
        </div>
        <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">
          Earnest Fundmaker
        </div>
        <div className="text-[11px] text-fg-4">
          Your Private Market Assistant · running 12 workflows
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Copilot"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
      >
        <X size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}

function BrainSwitcher({ active, onSelect }: { active: string; onSelect: (slug: string) => void }) {
  return (
    <section>
      <div className="mb-2 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        Active brains · {BRAINS.length}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {BRAINS.map((brain) => {
          const Icon = brain.icon;
          const isActive = brain.slug === active;
          return (
            <button
              key={brain.slug}
              type="button"
              onClick={() => onSelect(brain.slug)}
              aria-pressed={isActive}
              title={brain.role}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11.5px] font-medium transition',
                isActive
                  ? 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1'
                  : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2 hover:text-fg-1'
              )}
            >
              <Icon size={13} strokeWidth={1.9} aria-hidden />
              {brain.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RecommendedActions() {
  return (
    <section>
      <div className="mb-2 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        Recommended next steps
      </div>
      <div className="flex flex-col gap-1">
        {RECOMMENDED.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="group flex items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left text-[12.5px] text-fg-2 transition hover:border-hairline hover:bg-surface-1"
            >
              <Icon size={15} strokeWidth={1.9} className="flex-none text-fg-4" aria-hidden />
              <span className="flex-1">{action.label}</span>
              <ArrowUpRight
                size={14}
                strokeWidth={1.9}
                className="flex-none text-fg-5 opacity-0 transition group-hover:opacity-100"
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export interface CopilotDockProps {
  open: boolean;
  onClose: () => void;
}

/**
 * CopilotDock — the right-side slide-in Earn Copilot. Houses the Earn presence
 * header, the live chat (reuses `EarnChat`, which POSTs to `/api/ask-earn`), a
 * 15-brain switcher and recommended actions. Slides via transform only; never
 * transitions `color`.
 */
export function CopilotDock({ open, onClose }: CopilotDockProps) {
  const [activeBrain, setActiveBrain] = useState('earnest-fundmaker');

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Earn Copilot"
      aria-hidden={!open}
      className={cn(
        'fixed right-0 top-0 z-[45] flex h-full w-full max-w-[400px] flex-col border-l border-hairline bg-bg-1 shadow-[var(--shadow-lg)]',
        'transition-transform duration-300 ease-[cubic-bezier(.22,.61,.36,1)] will-change-transform',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <PresenceHeader onClose={onClose} />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <EarnChat />
        <RecommendedActions />
        <BrainSwitcher active={activeBrain} onSelect={setActiveBrain} />
      </div>
    </aside>
  );
}
