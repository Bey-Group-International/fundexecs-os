'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  LifeBuoy,
  Play,
  Search,
  Sparkles,
  X,
  type LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { GuidedTour } from '@/components/help/GuidedTour';
import {
  CHECKLIST,
  GUIDES,
  QUICK_LINKS,
  TOURS,
  type ChecklistItem,
  type HelpBlock,
  type HelpGuide,
  type HelpTour
} from '@/lib/help/content';

/* ============================================================================
 * HelpLauncher — the global "learn FundExecs OS" hub. A floating button (above
 * the Earn orb) opens a panel with search, a getting-started checklist, guided
 * tours, how-to guides, and quick links / Ask Earn hand-off. Mounted once in
 * AppShell so it's available on every authenticated screen.
 *
 * "Ask Earn" dispatches a `fx:earn-open` window event that AppShell listens for
 * to open the Earn dock — keeping the two systems decoupled.
 * ========================================================================= */

const CHECKLIST_KEY = 'fx-help-checklist-v1';

function GuideBlock({ block }: { block: HelpBlock }) {
  if (block.type === 'p') return <p className="text-[12.5px] leading-6 text-fg-3">{block.text}</p>;
  if (block.type === 'heading')
    return <h4 className="text-[12.5px] font-semibold text-fg-1">{block.text}</h4>;
  if (block.type === 'tip')
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2">
        <Sparkles size={13} strokeWidth={2} className="mt-0.5 flex-none text-gold-1" aria-hidden />
        <p className="text-[11.5px] leading-5 text-fg-2">{block.text}</p>
      </div>
    );
  return (
    <ol className="flex flex-col gap-1.5">
      {block.items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-6 text-fg-3">
          <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-surface-3 text-[9.5px] font-semibold tabular-nums text-fg-2">
            {i + 1}
          </span>
          {it}
        </li>
      ))}
    </ol>
  );
}

function Row({
  icon: Icon,
  title,
  subtitle,
  onClick,
  trailing
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-left transition hover:bg-surface-2"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-bg-1 text-azure-1">
        <Icon size={15} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-fg-1">{title}</span>
        {subtitle ? <span className="block truncate text-[11px] text-fg-4">{subtitle}</span> : null}
      </span>
      {trailing ?? <ChevronRight size={15} strokeWidth={2} className="flex-none text-fg-5" />}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-4">
      {children}
    </p>
  );
}

export function HelpLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [guide, setGuide] = useState<HelpGuide | null>(null);
  const [tour, setTour] = useState<HelpTour | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Load checklist progress once (deferred so we never setState synchronously
  // inside the effect body — mirrors the welcome banner pattern).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(CHECKLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        queueMicrotask(() => setDone(parsed));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((next: Record<string, boolean>) => {
    setDone(next);
    try {
      window.localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  // Esc closes the panel; click-outside closes too.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const startTour = useCallback((t: HelpTour) => {
    setOpen(false);
    setTour(t);
  }, []);

  const openEarn = useCallback(() => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('fx:earn-open'));
  }, []);

  const runChecklist = useCallback(
    (item: ChecklistItem) => {
      persist({ ...done, [item.id]: true });
      const action = item.action;
      if (action.kind === 'link') {
        setOpen(false);
        router.push(action.href);
      } else if (action.kind === 'tour') {
        const found = TOURS.find((x) => x.id === action.tourId);
        if (found) startTour(found);
      } else {
        openEarn();
      }
    },
    [done, persist, router, startTour, openEarn]
  );

  const toggleDone = useCallback(
    (id: string) => persist({ ...done, [id]: !done[id] }),
    [done, persist]
  );

  const completed = CHECKLIST.filter((c) => done[c.id]).length;
  const pct = Math.round((completed / CHECKLIST.length) * 100);

  // Search across guides + tours.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const guides = GUIDES.filter((g) =>
      `${g.title} ${g.summary} ${g.keywords}`.toLowerCase().includes(q)
    );
    const tours = TOURS.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(q));
    return { guides, tours };
  }, [query]);

  return (
    <>
      {/* Floating launcher button — sits above the Earn orb, azure (gold is
          reserved for Earn). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close help' : 'Help & learning'}
        aria-expanded={open}
        data-testid="help-launcher"
        className={cn(
          'fixed bottom-[5.25rem] right-5 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full',
          'border border-hairline bg-bg-1 text-azure-1 shadow-[var(--shadow-lg)]',
          'transition-transform duration-200 ease-[cubic-bezier(.22,.61,.36,1)]',
          'hover:-translate-y-0.5 hover:scale-[1.04] active:scale-95',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azure-1'
        )}
      >
        {open ? (
          <X size={20} strokeWidth={2.2} aria-hidden />
        ) : (
          <LifeBuoy size={20} strokeWidth={1.9} aria-hidden />
        )}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Help and learning"
          data-testid="help-panel"
          className="fixed bottom-[8.75rem] right-5 z-50 flex max-h-[min(72vh,640px)] w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-150 sm:w-[384px]"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
            {guide ? (
              <button
                type="button"
                onClick={() => setGuide(null)}
                aria-label="Back"
                className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <ArrowLeft size={16} strokeWidth={2} aria-hidden />
              </button>
            ) : (
              <EarnCoin size={22} online />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-fg-1">
                {guide ? guide.title : 'Help & learning'}
              </p>
              {!guide ? (
                <p className="truncate text-[11px] text-fg-4">Learn FundExecs OS in minutes</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <X size={15} strokeWidth={2} aria-hidden />
            </button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
            {guide ? (
              <div className="flex flex-col gap-3">
                <p className="text-[12px] text-fg-4">{guide.summary}</p>
                {guide.body.map((b, i) => (
                  <GuideBlock key={i} block={b} />
                ))}
                <button
                  type="button"
                  onClick={openEarn}
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[12px] font-medium text-fg-2 transition hover:bg-surface-2"
                >
                  <Sparkles size={14} strokeWidth={2} className="text-gold-1" aria-hidden />
                  Still stuck? Ask Earn
                </button>
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="relative mb-3">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5">
                    <Search size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search help…"
                    aria-label="Search help"
                    className="w-full rounded-xl border border-hairline bg-surface-1 py-2 pl-9 pr-3 text-[12.5px] text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)]"
                  />
                </div>

                {results ? (
                  <div className="flex flex-col gap-2">
                    {results.tours.length === 0 && results.guides.length === 0 ? (
                      <p className="px-1 py-6 text-center text-[12px] text-fg-4">
                        No matches. Try “Earn”, “credits”, or “integrations”.
                      </p>
                    ) : null}
                    {results.tours.map((t) => (
                      <Row
                        key={t.id}
                        icon={t.icon}
                        title={t.title}
                        subtitle={t.description}
                        onClick={() => startTour(t)}
                        trailing={<Play size={14} strokeWidth={2} className="text-azure-1" />}
                      />
                    ))}
                    {results.guides.map((g) => (
                      <Row
                        key={g.id}
                        icon={g.icon}
                        title={g.title}
                        subtitle={g.summary}
                        onClick={() => setGuide(g)}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Getting started checklist */}
                    <div className="mb-4 rounded-2xl border border-hairline bg-surface-1 p-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-fg-1">Getting started</span>
                        <span className="text-[11px] tabular-nums text-fg-4">
                          {completed}/{CHECKLIST.length}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--gold-1),var(--azure-1))] transition-[width] duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {CHECKLIST.map((item) => {
                          const isDone = !!done[item.id];
                          return (
                            <li key={item.id} className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => toggleDone(item.id)}
                                aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                                aria-pressed={isDone}
                                className={cn(
                                  'flex h-5 w-5 flex-none items-center justify-center rounded-full border transition',
                                  isDone
                                    ? 'border-success bg-[var(--success-soft)] text-success'
                                    : 'border-hairline text-transparent hover:border-azure-1'
                                )}
                              >
                                <Check size={12} strokeWidth={3} aria-hidden />
                              </button>
                              <span className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    'block truncate text-[12px] font-medium',
                                    isDone ? 'text-fg-4 line-through' : 'text-fg-1'
                                  )}
                                >
                                  {item.label}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => runChecklist(item)}
                                className="inline-flex flex-none items-center gap-1 rounded-lg border border-hairline bg-bg-1 px-2 py-1 text-[10.5px] font-medium text-azure-1 transition hover:bg-surface-2"
                              >
                                {item.cta}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {/* Tours */}
                    <SectionLabel>Guided tours</SectionLabel>
                    <div className="flex flex-col gap-2">
                      {TOURS.map((t) => (
                        <Row
                          key={t.id}
                          icon={t.icon}
                          title={t.title}
                          subtitle={t.description}
                          onClick={() => startTour(t)}
                          trailing={<Play size={14} strokeWidth={2} className="text-azure-1" />}
                        />
                      ))}
                    </div>

                    {/* Guides */}
                    <SectionLabel>How-to guides</SectionLabel>
                    <div className="flex flex-col gap-2">
                      {GUIDES.map((g) => (
                        <Row
                          key={g.id}
                          icon={g.icon}
                          title={g.title}
                          subtitle={g.summary}
                          onClick={() => setGuide(g)}
                        />
                      ))}
                    </div>

                    {/* Quick links + Ask Earn */}
                    <SectionLabel>More help</SectionLabel>
                    <div className="flex flex-col gap-2">
                      <Row
                        icon={Sparkles}
                        title="Ask Earn"
                        subtitle="Get answers in context, in plain English"
                        onClick={openEarn}
                        trailing={<ArrowRight size={14} strokeWidth={2} className="text-gold-1" />}
                      />
                      {QUICK_LINKS.map((l) => (
                        <Row
                          key={l.href}
                          icon={l.icon}
                          title={l.label}
                          subtitle={l.description}
                          onClick={() => {
                            setOpen(false);
                            router.push(l.href);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {tour ? <GuidedTour tour={tour} onClose={() => setTour(null)} /> : null}
    </>
  );
}

export default HelpLauncher;
