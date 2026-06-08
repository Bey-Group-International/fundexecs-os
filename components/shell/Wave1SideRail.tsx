'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ArrowRight, ChevronDown, Sparkles, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { AccountMenu } from './account/AccountMenu';
import type { LifecycleStage } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';
import { compactMoney } from '@/lib/format';
import { FX_EASE, FX_SPRING } from '@/components/dashboard/command/motion';
import {
  RAIL_GROUPS,
  RAIL_PINNED,
  STAGE_TO_GROUP_KEYS,
  type RailGroupKey,
  type RailLauncher,
  type RailNavGroup,
  type RailNavItem
} from './rail-nav';
import {
  getRailCollapseServerSnapshot,
  getRailCollapseSnapshot,
  subscribeRailCollapse,
  writeRailCollapseState
} from './rail-collapse-storage';

/* ----------------------------------------------------------------------------
 * Re-exports — keep the registry reachable from the historical module path so
 * existing importers (AppShell, dashboard-rail-signals) don't break.
 * --------------------------------------------------------------------------*/

export { RAIL_GROUPS, RAIL_PINNED, STAGE_TO_GROUP_KEYS };
export type { RailGroupKey, RailNavGroup, RailNavItem, RailLauncher };

/* ----------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------------*/

/** Live-signal payload the rail accepts — keyed by item `href`. */
export interface RailSignal {
  /** Pre-formatted value (e.g. "12", "78%", "$4.2M"). */
  value: string | number;
  tone?: BadgeTone;
  /** Hover hint on the badge. */
  hint?: string;
  /**
   * Raw dollars-at-risk for the cluster rollup to sum (when the badge is a $
   * figure). Display-only badges (scores, percentages, realized capital) omit
   * this so they don't inflate the cluster's at-risk total.
   */
  amount?: number;
}

/**
 * The condensed operating meter the rail pins under Command Center — the same
 * engine output the Command Center hero shows (readiness + loop position) plus
 * the single highest-leverage next move, so the rail itself tells the operator
 * where they are in the loop and what to do next.
 */
export interface RailMomentum {
  /** 0–100 progress through the seven-stage loop. */
  loopProgress: number;
  /** 0–100 institutional-readiness score. */
  readinessScore: number;
  /** Current stage label, e.g. "Convert LPs". */
  stageLabel: string;
  /** 0-based stage ordinal (0–6). */
  stageIndex: number;
  /** Total stages in the loop (7). */
  stageCount: number;
  /** The single highest-leverage move, when one exists. */
  nextBestAction?: {
    title: string;
    cta: string;
    href: string;
  };
}

export interface NavSignals {
  /** Current lifecycle stage — drives stage-aware auto-expand + gold emphasis. */
  currentStage?: LifecycleStage;
  /** Per-href signal badges. */
  badges?: Record<string, RailSignal>;
  /** Condensed readiness/loop meter + next-best-action for the rail spine. */
  momentum?: RailMomentum;
}

export interface Wave1SideRailProps {
  pathname: string;
  open: boolean;
  onClose: () => void;
  identity: ShellIdentity;
  /** Live signals from the Dashboard loader (current stage + per-item counts). */
  signals?: NavSignals;
  /** Optional card the rail mounts at the top of "The Record" cluster.
   *  Typically `<ProfileRailSummary>` server-rendered upstream. */
  sourceOfTruthSummary?: ReactNode;
  /** Override default sign-out (defaults to Supabase client signOut). */
  onSignOut?: () => void | Promise<void>;
}

/* ----------------------------------------------------------------------------
 * Rollup + active-state helpers
 * --------------------------------------------------------------------------*/

const TONE_SEVERITY: Record<BadgeTone, number> = {
  neutral: 0,
  info: 1,
  azure: 2,
  success: 3,
  gold: 4,
  warning: 5,
  danger: 6
};

interface GroupRollup {
  /** Pre-formatted headline — a compact $ total ("$4.2M") or a plain count. */
  label: string;
  tone: BadgeTone;
}

/** Strip a query string for pathname matching. */
function baseHref(href: string): string {
  return href.split('?')[0];
}

/**
 * Compute a per-cluster rollup from the per-item `signals.badges`. When child
 * badges carry a raw `amount` (value-at-stake $), the rollup sums dollars and
 * renders a compact figure; otherwise it falls back to summing the numeric
 * portion of each badge (legacy counts). Tone follows the highest severity.
 */
function computeGroupRollup(
  group: RailNavGroup,
  badges: Record<string, RailSignal> | undefined
): GroupRollup | null {
  if (!badges) return null;
  let dollars = 0;
  let hasDollars = false;
  let count = 0;
  let tone: BadgeTone | null = null;
  let any = false;
  // Gather every routable href in the cluster (items + nested children), then
  // dedupe by resolved badge key so a badge shared by alias routes counts once.
  const hrefs: string[] = [];
  for (const item of group.items) {
    if (item.href) hrefs.push(item.href);
    for (const sub of item.children ?? []) if (sub.href) hrefs.push(sub.href);
  }
  const seen = new Set<string>();
  for (const href of hrefs) {
    const key = badges[href] ? href : badges[baseHref(href)] ? baseHref(href) : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const signal = badges[key];
    any = true;
    if (typeof signal.amount === 'number' && signal.amount > 0) {
      dollars += signal.amount;
      hasDollars = true;
      // Only $-bearing badges drive the cluster tone — they're the at-risk ones.
      const childTone = signal.tone ?? 'azure';
      if (tone === null || TONE_SEVERITY[childTone] > TONE_SEVERITY[tone]) tone = childTone;
    } else {
      const numeric = parseInt(String(signal.value), 10);
      if (!Number.isNaN(numeric)) count += numeric;
    }
  }
  if (!any) return null;
  if (hasDollars) return { label: compactMoney(dollars), tone: tone ?? 'azure' };
  if (count > 0) return { label: String(count), tone: tone ?? 'azure' };
  return null;
}

/**
 * Resolve a single active item key across pinned + every cluster item, so two
 * items sharing a base route (e.g. Capital Partners / Service Providers →
 * /partners) never both highlight. Longest base match wins; ties resolve to the
 * first item scanned (pinned first, then cluster order).
 */
function resolveActiveKey(pathname: string, fullPath: string): string | null {
  const flat: Array<{ key: string; href: string }> = [];
  if (RAIL_PINNED.href) flat.push({ key: 'pinned', href: RAIL_PINNED.href });
  RAIL_GROUPS.forEach((g) =>
    g.items.forEach((it, i) => {
      if (it.href) flat.push({ key: `${g.key}:${i}`, href: it.href });
      (it.children ?? []).forEach((sub, j) => {
        if (sub.href) flat.push({ key: `${g.key}:${i}:${j}`, href: sub.href });
      });
    })
  );
  let bestKey: string | null = null;
  let bestScore = -1;
  for (const f of flat) {
    const base = baseHref(f.href);
    const baseMatch = pathname === base || pathname.startsWith(`${base}/`);
    let score = -1;
    if (f.href.includes('?')) {
      // Query-scoped: exact full-path wins big; base match is a weak fallback so
      // the bare route still lights one entry.
      if (fullPath === f.href) score = 1000 + base.length;
      else if (baseMatch) score = base.length;
    } else if (baseMatch) {
      score = base.length;
    }
    // `>` (not `>=`) keeps ties on the first-scanned item.
    if (score > bestScore) {
      bestScore = score;
      bestKey = f.key;
    }
  }
  return bestKey;
}

/** Find the cluster that owns the active route, if any. */
function findActiveGroupKey(activeKey: string | null): RailGroupKey | null {
  if (!activeKey || activeKey === 'pinned') return null;
  const [groupKey] = activeKey.split(':');
  return (RAIL_GROUPS.find((g) => g.key === groupKey)?.key ?? null) as RailGroupKey | null;
}

/** Open the Earn dock, seeding a scoped prompt. */
function openEarn(prompt: string) {
  window.dispatchEvent(new CustomEvent('fx:earn-open', { detail: { prompt } }));
}

/* ----------------------------------------------------------------------------
 * Component
 * --------------------------------------------------------------------------*/

export function Wave1SideRail({
  pathname,
  open,
  onClose,
  identity,
  signals,
  sourceOfTruthSummary,
  onSignOut
}: Wave1SideRailProps) {
  const emphasizedGroups = signals?.currentStage
    ? new Set<RailGroupKey>(STAGE_TO_GROUP_KEYS[signals.currentStage])
    : new Set<RailGroupKey>();

  // Full path (incl. query) lets query-scoped rail entries highlight precisely.
  const searchParams = useSearchParams();
  const search = searchParams?.toString();
  const fullPath = search ? `${pathname}?${search}` : pathname;
  const activeKey = resolveActiveKey(pathname, fullPath);
  const activeGroupKey = findActiveGroupKey(activeKey);

  // Auto-expand baseline: active cluster + stage-emphasized clusters. Secondary
  // clusters (Desk Tools) stay collapsed unless they own the route. Manual
  // overrides win on top.
  const autoExpanded = new Set<RailGroupKey>(emphasizedGroups);
  if (activeGroupKey) autoExpanded.add(activeGroupKey);

  const overrides = useSyncExternalStore(
    subscribeRailCollapse,
    getRailCollapseSnapshot,
    getRailCollapseServerSnapshot
  );

  function isExpanded(group: RailNavGroup): boolean {
    const manual = overrides[group.key];
    if (typeof manual === 'boolean') return manual;
    return autoExpanded.has(group.key);
  }

  function toggleGroup(group: RailNavGroup) {
    writeRailCollapseState(group.key, !isExpanded(group));
  }

  async function defaultSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  async function handleSignOut() {
    if (onSignOut) return void (await onSignOut());
    await defaultSignOut();
  }

  const pinnedActive = activeKey === 'pinned';

  return (
    <MotionConfig reducedMotion="user">
      <aside
        data-testid="wave1-side-rail"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-full w-[252px] flex-none flex-col border-r border-hairline bg-bg-1 transition-transform duration-200 lg:static lg:z-10 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand — the Earn coin is the OS mark + home affordance. */}
        <div className="flex items-center gap-2.5 px-[18px] pb-3 pt-[18px]">
          <Link
            href="/command-center"
            onClick={onClose}
            aria-label="FundExecs OS — go to Command Center"
            data-testid="side-rail-brand-home"
            className="flex flex-1 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-gold-1 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-1"
          >
            <EarnCoin size={30} className="flex-none" />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">
              FundExecs <span className="font-medium text-fg-4">OS</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            data-testid="side-rail-close-btn"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1 hover:text-fg-1 lg:hidden"
          >
            <X size={16} strokeWidth={1.9} aria-hidden />
          </button>
        </div>

        <nav
          className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2"
          data-testid="side-rail-nav"
        >
          {/* Pinned Command Center */}
          <PinnedLink
            item={RAIL_PINNED}
            active={pinnedActive}
            signal={RAIL_PINNED.href ? signals?.badges?.[RAIL_PINNED.href] : undefined}
            onClick={onClose}
          />

          {/* The operating spine — readiness/loop meter + next-best-action. */}
          {signals?.momentum ? (
            <MomentumSpine momentum={signals.momentum} onLinkClick={onClose} />
          ) : null}

          {RAIL_GROUPS.map((group) => {
            const extraTop = group.key === 'build' ? sourceOfTruthSummary : undefined;
            return (
              <NavGroup
                key={group.key}
                group={group}
                activeKey={activeKey}
                emphasized={emphasizedGroups.has(group.key)}
                expanded={isExpanded(group)}
                onToggle={() => toggleGroup(group)}
                rollup={computeGroupRollup(group, signals?.badges)}
                badges={signals?.badges}
                onLinkClick={onClose}
                extraTop={extraTop}
              />
            );
          })}
        </nav>

        <div data-testid="side-rail-user-footer">
          <AccountMenu identity={identity} onSignOut={handleSignOut} onNavigate={onClose} />
        </div>
      </aside>
    </MotionConfig>
  );
}

/* ----------------------------------------------------------------------------
 * Subcomponents
 * --------------------------------------------------------------------------*/

function PinnedLink({
  item,
  active,
  signal,
  onClick
}: {
  item: RailNavItem;
  active: boolean;
  signal?: RailSignal;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href ?? '/command-center'}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-testid="rail-link-pinned"
      title={item.hint}
      className={cn(
        'relative flex items-center gap-3 rounded-[12px] border px-2.5 py-2.5 text-[13px] font-semibold transition-[background,box-shadow,transform] will-change-transform motion-reduce:transition-none',
        active
          ? 'border-[var(--azure-line)] bg-gradient-to-r from-[var(--azure-soft)] to-surface-1 text-fg-1'
          : 'border-hairline text-fg-2 hover:translate-x-0.5 hover:bg-surface-1'
      )}
    >
      {active ? (
        <span
          className="absolute -left-1.5 bottom-2 top-2 w-[3px] rounded-full bg-azure-1"
          aria-hidden
        />
      ) : null}
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden
        className={active ? 'text-azure-1' : 'text-fg-3'}
      />
      <span className="flex-1">{item.label}</span>
      {signal ? (
        <Badge tone={signal.tone ?? 'azure'} className="px-1.5 py-0.5 text-[10px] tabular-nums">
          {signal.value}
        </Badge>
      ) : null}
    </Link>
  );
}

interface NavGroupProps {
  group: RailNavGroup;
  activeKey: string | null;
  emphasized: boolean;
  expanded: boolean;
  onToggle: () => void;
  rollup: GroupRollup | null;
  badges?: Record<string, RailSignal>;
  onLinkClick: () => void;
  extraTop?: ReactNode;
}

function NavGroup({
  group,
  activeKey,
  emphasized,
  expanded,
  onToggle,
  rollup,
  badges,
  onLinkClick,
  extraTop
}: NavGroupProps) {
  const panelId = useId();
  const headerRef = useRef<HTMLButtonElement | null>(null);
  const GroupIcon = group.icon;

  useEffect(() => {
    if (emphasized && expanded) headerRef.current?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emphasized]);

  return (
    <motion.section
      layout
      data-testid={`rail-group-${group.key}`}
      data-state={expanded ? 'open' : 'collapsed'}
      className={cn(
        'overflow-hidden rounded-[12px] border bg-bg-1',
        emphasized ? 'border-[var(--azure-line)]' : 'border-hairline'
      )}
    >
      {/* Collapsible header */}
      <button
        type="button"
        ref={headerRef}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid={`rail-group-toggle-${group.key}`}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-2 text-left transition-[background] hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1',
          emphasized ? 'text-gold-1' : 'text-fg-4'
        )}
      >
        <GroupIcon size={14} strokeWidth={1.9} aria-hidden className="flex-none" />
        <span className="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]">
          {group.label}
        </span>
        {rollup ? (
          <Badge
            tone={rollup.tone}
            className="px-1.5 py-0.5 text-[10px] tabular-nums"
            title={`${group.label} — ${rollup.label} at stake`}
          >
            {rollup.label}
          </Badge>
        ) : null}
        <motion.span animate={{ rotate: expanded ? 0 : -90 }} transition={FX_SPRING}>
          <ChevronDown size={14} strokeWidth={2} aria-hidden className="flex-none text-fg-5" />
        </motion.span>
      </button>

      {/* Panel */}
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={panelId}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: FX_EASE }}
            className="overflow-hidden"
          >
            {extraTop ? <div className="px-2.5 pb-1.5 pt-0.5">{extraTop}</div> : null}
            {group.launcher ? (
              <div className="px-1.5 pt-1.5">
                <LauncherButton launcher={group.launcher} onTrigger={onLinkClick} />
              </div>
            ) : null}
            <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5 pt-1">
              {group.items.map((item, i) => (
                <NavItem
                  key={`${group.key}:${i}`}
                  item={item}
                  groupKey={group.key}
                  index={i}
                  activeKey={activeKey}
                  badges={badges}
                  onLinkClick={onLinkClick}
                />
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

/** Slugify a label for stable test ids. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * NavItem — one loop entry. Renders one of: a route Link, an Earn-action button
 * (`earnPrompt`), a muted "soon" row (no href), or an expandable parent
 * (`children`, e.g. Capital → Equity/Debt/Hybrid).
 */
function NavItem({
  item,
  groupKey,
  index,
  activeKey,
  badges,
  onLinkClick
}: {
  item: RailNavItem;
  groupKey: RailGroupKey;
  index: number;
  activeKey: string | null;
  badges?: Record<string, RailSignal>;
  onLinkClick: () => void;
}) {
  const Icon = item.icon;

  if (item.children && item.children.length > 0) {
    return (
      <NavParent
        item={item}
        groupKey={groupKey}
        index={index}
        activeKey={activeKey}
        onLinkClick={onLinkClick}
      />
    );
  }

  // Earn-action item (AI verb — opens the dock, no route).
  if (item.earnPrompt) {
    return (
      <li>
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          transition={FX_SPRING}
          onClick={() => {
            openEarn(item.earnPrompt as string);
            onLinkClick();
          }}
          title={item.hint}
          data-testid={`rail-action-${slug(item.label)}`}
          className="relative flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-fg-3 transition-[background,transform] will-change-transform hover:translate-x-0.5 hover:bg-surface-1 motion-reduce:transition-none"
        >
          <Icon size={16} strokeWidth={1.9} aria-hidden className="text-gold-1" />
          <span className="flex-1">{item.label}</span>
          <Sparkles size={12} strokeWidth={2} aria-hidden className="text-gold-1/70" />
        </motion.button>
      </li>
    );
  }

  // "Soon" — routed surface not built yet; muted + non-interactive.
  if (!item.href) {
    return (
      <li>
        <div
          title={item.hint}
          data-testid={`rail-soon-${slug(item.label)}`}
          className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-fg-5"
        >
          <Icon size={16} strokeWidth={1.9} aria-hidden />
          <span className="flex-1">
            {item.label}
            <span className="ml-1.5 text-[9.5px] font-semibold uppercase tracking-[0.11em] text-fg-5">
              soon
            </span>
          </span>
        </div>
      </li>
    );
  }

  // Normal route link.
  const itemKey = `${groupKey}:${index}`;
  const active = activeKey === itemKey;
  const signal = badges?.[item.href] ?? badges?.[baseHref(item.href)];
  return (
    <li>
      <Link
        href={item.href}
        onClick={onLinkClick}
        aria-current={active ? 'page' : undefined}
        title={item.hint}
        data-testid={`rail-link-${baseHref(item.href).replace(/^\//, '') || 'root'}${
          item.href.includes('?') ? `-${item.href.split('?')[1].replace(/[^a-z0-9]/gi, '')}` : ''
        }`}
        className={cn(
          'relative flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px] font-medium transition-[background,box-shadow,transform] will-change-transform motion-reduce:transition-none motion-reduce:hover:translate-x-0',
          active
            ? 'bg-gradient-to-r from-[var(--azure-soft)] to-surface-1 text-fg-1'
            : 'text-fg-3 hover:translate-x-0.5 hover:bg-surface-1'
        )}
      >
        {active ? (
          <span
            className="absolute -left-1.5 bottom-1.5 top-1.5 w-[3px] rounded-full bg-azure-1"
            aria-hidden
          />
        ) : null}
        <Icon size={16} strokeWidth={1.9} aria-hidden />
        <span className="flex-1">{item.label}</span>
        {signal ? (
          <Badge
            tone={signal.tone ?? 'azure'}
            className="px-1.5 py-0.5 text-[10px] tabular-nums"
            title={signal.hint}
          >
            {signal.value}
          </Badge>
        ) : null}
      </Link>
    </li>
  );
}

/** NavParent — an item with an expandable third tier of sub-rows. */
function NavParent({
  item,
  groupKey,
  index,
  activeKey,
  onLinkClick
}: {
  item: RailNavItem;
  groupKey: RailGroupKey;
  index: number;
  activeKey: string | null;
  onLinkClick: () => void;
}) {
  const panelId = useId();
  const Icon = item.icon;
  const children = item.children ?? [];
  const childActive = children.some((_, j) => activeKey === `${groupKey}:${index}:${j}`);
  // Auto-open when a child is active; manual toggle overrides afterward.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? childActive;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        title={item.hint}
        data-testid={`rail-parent-${slug(item.label)}`}
        className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-fg-3 transition-[background] hover:bg-surface-1"
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden />
        <span className="flex-1">{item.label}</span>
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={FX_SPRING}>
          <ChevronDown size={13} strokeWidth={2} aria-hidden className="text-fg-5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            id={panelId}
            key="sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: FX_EASE }}
            className="ml-[18px] flex flex-col gap-0.5 overflow-hidden border-l border-hairline pl-1.5 pt-0.5"
          >
            {children.map((sub, j) => {
              const subKey = `${groupKey}:${index}:${j}`;
              const active = activeKey === subKey;
              const isSoon = !sub.href || sub.live === false;
              return (
                <li key={subKey}>
                  {isSoon || !sub.href ? (
                    <div
                      title={sub.hint}
                      className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[12px] text-fg-5"
                    >
                      <span className="h-1 w-1 flex-none rounded-full bg-fg-5/60" aria-hidden />
                      {sub.label}
                      <span className="ml-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-5">
                        soon
                      </span>
                    </div>
                  ) : (
                    <Link
                      href={sub.href}
                      onClick={onLinkClick}
                      aria-current={active ? 'page' : undefined}
                      title={sub.hint}
                      data-testid={`rail-sublink-${slug(item.label)}-${slug(sub.label)}`}
                      className={cn(
                        'flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[12px] transition-[background] hover:bg-surface-1',
                        active ? 'bg-[var(--azure-soft)] font-medium text-fg-1' : 'text-fg-3'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 flex-none rounded-full',
                          active ? 'bg-azure-1' : 'bg-fg-5/60'
                        )}
                        aria-hidden
                      />
                      {sub.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

/**
 * MomentumSpine — the condensed operating meter pinned under Command Center.
 * The full `ReadinessGauge` + loop hero lives on Command Center; this is its
 * always-in-view companion: a thin readiness bar, the operator's position in
 * the loop, and the one highest-leverage move (azure, not gold — gold stays
 * reserved for Earn). The next move deep-links to the same action the dashboard
 * surfaces, so the rail nudges without the operator opening the dashboard.
 */
function MomentumSpine({
  momentum,
  onLinkClick
}: {
  momentum: RailMomentum;
  onLinkClick: () => void;
}) {
  const { loopProgress, readinessScore, stageLabel, stageIndex, stageCount, nextBestAction } =
    momentum;
  return (
    <div
      data-testid="rail-momentum"
      className="rounded-[12px] border border-hairline bg-surface-1 px-2.5 py-2.5"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          Readiness
        </span>
        <span className="text-[12px] font-semibold tabular-nums text-fg-1">
          {readinessScore}
          <span className="text-fg-4">/100</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-hairline"
        role="progressbar"
        aria-valuenow={readinessScore}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Institutional readiness"
      >
        <motion.div
          className="h-full rounded-full bg-azure-1"
          initial={{ width: 0 }}
          animate={{ width: `${readinessScore}%` }}
          transition={FX_SPRING}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-fg-4">
        <span className="font-medium text-fg-2">{stageLabel}</span> · stage {stageIndex + 1}/
        {stageCount} · loop {loopProgress}%
      </p>
      {nextBestAction ? (
        <Link
          href={nextBestAction.href}
          onClick={onLinkClick}
          data-testid="rail-next-action"
          title={`${nextBestAction.cta}: ${nextBestAction.title}`}
          className="mt-2 flex items-center gap-1.5 rounded-[9px] border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2 py-1.5 text-[11px] font-semibold text-azure-1 transition-transform hover:translate-x-0.5"
        >
          <span className="text-[8.5px] uppercase tracking-[0.1em] text-azure-1/70">Next</span>
          <span className="min-w-0 flex-1 truncate">{nextBestAction.title}</span>
          <ArrowRight size={12} strokeWidth={2.4} aria-hidden className="flex-none" />
        </Link>
      ) : null}
    </div>
  );
}

/** Earn action launcher — gold (reserved for Earn), opens the dock scoped. */
function LauncherButton({
  launcher,
  onTrigger
}: {
  launcher: RailLauncher;
  onTrigger: () => void;
}) {
  const Icon = launcher.icon;
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={FX_SPRING}
      onClick={() => {
        openEarn(launcher.prompt);
        onTrigger();
      }}
      data-testid={`rail-launcher-${launcher.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      className="flex w-full items-center gap-2 rounded-[10px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-2 text-left transition-[background] hover:brightness-[1.05] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1"
    >
      <Icon size={15} strokeWidth={2} aria-hidden className="flex-none text-gold-1" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gold-1">
        {launcher.label}
      </span>
      <Sparkles size={12} strokeWidth={2} aria-hidden className="flex-none text-gold-1/70" />
    </motion.button>
  );
}

export default Wave1SideRail;
