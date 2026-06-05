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
import { EarnChat } from '@/app/ask-earn/EarnChat';
import { TeamAvatar, getCOO, getSpecialists, type TeamMember } from '@/lib/team';
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
  const earn = getCOO();
  return (
    <div className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
      <TeamAvatar member={earn} size={40} online glow className="flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
          {earn.position}
        </div>
        <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">{earn.name}</div>
        <div className="text-[11px] text-fg-4">
          Leads a team of {getSpecialists().length} specialists
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Earn dock"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
      >
        <X size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}

function TeamStrip({ active, onSelect }: { active: string; onSelect: (slug: string) => void }) {
  const specialists = getSpecialists();
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          The Team · {specialists.length} specialists
        </div>
        <div className="text-[10.5px] text-fg-5">tap to focus</div>
      </div>
      {/* Compact avatar row with name + position revealed on hover/focus. */}
      <ul className="grid grid-cols-7 gap-1.5">
        {specialists.map((m) => {
          const isActive = m.slug === active;
          return (
            <li key={m.slug}>
              <button
                type="button"
                onClick={() => onSelect(m.slug)}
                aria-pressed={isActive}
                aria-label={`${m.name}, ${m.position}`}
                title={`${m.name} — ${m.position}`}
                className={cn(
                  'group relative flex w-full items-center justify-center rounded-xl border p-1.5 transition',
                  isActive
                    ? 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
                    : 'border-transparent bg-transparent hover:border-hairline hover:bg-surface-1'
                )}
              >
                <TeamAvatar member={m} size={28} />
              </button>
            </li>
          );
        })}
      </ul>
      <ActiveSpecialistCard slug={active} />
    </section>
  );
}

function ActiveSpecialistCard({ slug }: { slug: string }) {
  const specialists = getSpecialists();
  const member = specialists.find((m) => m.slug === slug) ?? specialists[0];
  if (!member) return null;
  return (
    <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
      <TeamAvatar member={member} size={32} className="flex-none" />
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-fg-1">{member.name}</div>
        <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-azure-1">
          {member.position}
        </div>
        <p className="mt-1 text-[11.5px] leading-5 text-fg-3">{member.oneLiner}</p>
      </div>
    </div>
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

export interface EarnDockProps {
  open: boolean;
  onClose: () => void;
}

/**
 * EarnDock — the right-side slide-in Earn surface. Houses the COO presence
 * header (Earn + position), the live chat (reuses `EarnChat`, which POSTs
 * to `/api/ask-earn`), recommended actions, and a compact "Team" strip of
 * the 14 specialists. Slides via transform only; never transitions `color`.
 */
export function EarnDock({ open, onClose }: EarnDockProps) {
  const specialists = getSpecialists();
  const initialSpecialist: TeamMember = specialists[0]!;
  const [activeSpecialist, setActiveSpecialist] = useState<string>(initialSpecialist.slug);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Earn dock"
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
        <TeamStrip active={activeSpecialist} onSelect={setActiveSpecialist} />
      </div>
    </aside>
  );
}
