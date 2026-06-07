'use client';

import { useRef, useState } from 'react';
import { X, ArrowUpRight, ChevronDown } from 'lucide-react';
import { EarnChat, type EarnChatHandle } from '@/app/ask-earn/EarnChat';
import { TeamAvatar, getCOO, getSpecialists, type TeamMember } from '@/lib/team';
import { cn } from '@/lib/utils';
import { useEarnContext } from './EarnContext';
import { copyFor } from './EarnContextCopy';
import { EarnAgentActivity } from './EarnAgentActivity';

function PresenceHeader({
  onClose,
  subtitle,
  activity
}: {
  onClose: () => void;
  subtitle: string;
  activity: string;
}) {
  const earn = getCOO();
  return (
    <div
      className="flex items-start gap-3 border-b border-hairline px-4 py-3.5"
      data-testid="earn-dock-header"
    >
      <TeamAvatar member={earn} size={40} online glow className="flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
          Chief Operating Officer · your live AI guide
        </div>
        <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">{earn.name}</div>
        <div className="mt-0.5 text-[11px] text-fg-3" data-testid="earn-dock-context-subtitle">
          {subtitle}
        </div>
        <div
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-[10.5px] text-fg-4"
          data-testid="earn-dock-activity-glimpse"
        >
          <span
            aria-hidden
            className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-gold-1"
          />
          {activity}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Earn dock"
        data-testid="earn-dock-close-btn"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
      >
        <X size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}

function TeamStrip({
  active,
  onSelect,
  onSeed
}: {
  active: string;
  onSelect: (slug: string) => void;
  onSeed: (text: string) => void;
}) {
  const specialists = getSpecialists();
  return (
    <section>
      <div className="mb-2 px-0.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Your specialist team · {specialists.length}
        </div>
        <p className="mt-1 text-[11.5px] leading-5 text-fg-3">
          Ask Earn anything — he coordinates the whole team and routes your request to the right
          specialist. Tap one to see what they do.
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {specialists.map((m) => {
          const isActive = m.slug === active;
          return (
            <li key={m.slug}>
              <button
                type="button"
                onClick={() => onSelect(m.slug)}
                aria-pressed={isActive}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition',
                  isActive
                    ? 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
                    : 'border-transparent hover:border-hairline hover:bg-surface-1'
                )}
              >
                <TeamAvatar member={m} size={30} className="flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-fg-1">{m.name}</div>
                  <div className="truncate text-[11px] text-fg-3">{m.position}</div>
                </div>
              </button>
              {isActive ? (
                <div className="mb-1 mt-1 px-2.5">
                  <p className="text-[11.5px] leading-5 text-fg-3">{m.oneLiner}</p>
                  <button
                    type="button"
                    onClick={() =>
                      onSeed(
                        `Bring in ${m.name} (${m.position}). Given what I'm working on right now, what should we tackle first, and how can they help?`
                      )
                    }
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-gold-1 transition hover:text-gold-2 focus-visible:underline focus-visible:outline-none"
                  >
                    Ask {m.name.split(' ')[0]} to step in
                    <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecommendedActions({
  kind,
  onSeed
}: {
  kind: ReturnType<typeof useEarnContext>['kind'];
  onSeed: (text: string) => void;
}) {
  const copy = copyFor(kind);
  return (
    <section data-testid="earn-dock-actions" data-context={kind}>
      <div className="mb-2 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        Here&apos;s what I can do right now
      </div>
      <div className="flex flex-col gap-1">
        {copy.actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onSeed(action.prompt)}
              className="group flex items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left text-[12.5px] text-fg-2 transition hover:border-[var(--gold-line)] hover:bg-[var(--gold-soft)] focus-visible:border-[var(--gold-line)] focus-visible:outline-none"
              data-testid={`earn-action-${action.label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')}`}
              title={`Ask Earn: ${action.prompt}`}
            >
              <Icon
                size={15}
                strokeWidth={1.9}
                className="flex-none text-fg-4 transition group-hover:text-gold-1"
                aria-hidden
              />
              <span className="flex-1">{action.label}</span>
              <ArrowUpRight
                size={14}
                strokeWidth={1.9}
                className="flex-none -translate-x-1 text-gold-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
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
 * EarnDock — the right-side slide-in Earn surface.
 *
 * Reads the current `EarnContext` (route default + drawer overrides) and
 * switches its subtitle, activity-glimpse, and quick-actions accordingly.
 * Voice stays "Chief Operating Officer · your live AI guide" everywhere —
 * context-specific copy renders as the focused subtitle and the action chip
 * list. The chat path (`EarnChat` → `/api/ask-earn`) is untouched.
 */
export function EarnDock({ open, onClose }: EarnDockProps) {
  const specialists = getSpecialists();
  const initialSpecialist: TeamMember = specialists[0]!;
  const [activeSpecialist, setActiveSpecialist] = useState<string>(initialSpecialist.slug);
  // Chat-first layout: once a thread exists the chat fills the dock and the
  // actions + team recede into a collapsible panel (re-openable).
  const [hasThread, setHasThread] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // Live agent-activity: escalates the desk strip to "working" while a turn runs.
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<EarnChatHandle>(null);
  const earnCtx = useEarnContext();
  const copy = copyFor(earnCtx.kind);

  // Quick actions + "ask a specialist to step in" auto-send and let Earn act.
  function runChat(text: string) {
    chatRef.current?.seedAndSend(text);
    setPanelOpen(false);
  }

  // Entity-specific subtitle when a drawer override gives us a label.
  const subtitle = earnCtx.entityLabel
    ? `${copy.subtitle} · ${earnCtx.entityLabel}`
    : copy.subtitle;

  const starterPanel = (
    <>
      <RecommendedActions kind={earnCtx.kind} onSeed={runChat} />
      <TeamStrip active={activeSpecialist} onSelect={setActiveSpecialist} onSeed={runChat} />
    </>
  );

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Earn dock"
      aria-hidden={!open}
      // `inert` keeps the entire subtree out of the tab order + a11y tree
      // when the dock is closed — fixes the axe `aria-hidden-focus` rule
      // (focusable chat textarea + buttons inside an aria-hidden ancestor).
      {...(open ? {} : { inert: '' as unknown as boolean })}
      data-testid="earn-dock"
      data-context={earnCtx.kind}
      className={cn(
        'fixed right-0 top-0 z-[45] flex h-full w-full max-w-[400px] flex-col border-l border-hairline bg-bg-1 shadow-[var(--shadow-lg)]',
        'transition-transform duration-300 ease-[cubic-bezier(.22,.61,.36,1)] will-change-transform',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Gold top-accent — keeps the dock from reading flat; gold = Earn. */}
      <div
        aria-hidden
        className="h-0.5 flex-none bg-gradient-to-r from-transparent via-gold-1 to-transparent"
      />
      <PresenceHeader onClose={onClose} subtitle={subtitle} activity={copy.activity} />

      {/* Live desk strip — who's on point for this surface, reacting to context
          and escalating while Earn is working. */}
      <EarnAgentActivity kind={earnCtx.kind} busy={busy} className="mx-4 mt-3 flex-none" />

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
        {hasThread ? (
          <div className="flex-none">
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              data-testid="earn-dock-panel-toggle"
              className="flex w-full items-center justify-between rounded-lg border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11px] font-semibold text-fg-3 transition hover:bg-surface-2"
            >
              Actions &amp; specialist team
              <ChevronDown
                size={14}
                strokeWidth={2}
                className={cn('transition-transform', panelOpen && 'rotate-180')}
                aria-hidden
              />
            </button>
            {panelOpen ? (
              <div className="mt-3 max-h-[42vh] space-y-4 overflow-y-auto">{starterPanel}</div>
            ) : null}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">{starterPanel}</div>
        )}

        <EarnChat
          ref={chatRef}
          context={{
            kind: earnCtx.kind,
            entityId: earnCtx.entityId,
            entityLabel: earnCtx.entityLabel
          }}
          onThreadChange={setHasThread}
          onBusyChange={setBusy}
        />
      </div>
    </aside>
  );
}
