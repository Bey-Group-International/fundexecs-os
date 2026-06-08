'use client';

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { AccountMenu } from './account/AccountMenu';
import type { LifecycleStage } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';
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
  /** Pre-formatted value (e.g. "12", "78%"). */
  value: string | number;
  tone?: BadgeTone;
  /** Hover hint on the badge. */
  hint?: string;
}

export interface NavSignals {
  /** Current lifecycle stage — drives stage-aware auto-expand + gold emphasis. */
  currentStage?: LifecycleStage;
  /** Per-href signal badges. */
  badges?: Record<string, RailSignal>;
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
  count: number;
  tone: BadgeTone;
}

/** Strip a query string for pathname matching. */
function baseHref(href: string): string {
  return href.split('?')[0];
}

/**
 * Compute a per-cluster rollup from the per-item `signals.badges`. Count sums
 * the numeric portion of each child badge; tone follows the highest severity.
 */
function computeGroupRollup(
  group: RailNavGroup,
  badges: Record<string, RailSignal> | undefined
): GroupRollup | null {
  if (!badges) return null;
  let count = 0;
  let tone: BadgeTone | null = null;
  let any = false;
  // Dedupe by resolved badge key so a single badge shared by alias items (e.g.
  // /profile for Profile + Capital Readiness) is counted at most once.
  const seen = new Set<string>();
  for (const item of group.items) {
    const key = badges[item.href]
      ? item.href
      : badges[baseHref(item.href)]
        ? baseHref(item.href)
        : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const signal = badges[key];
    any = true;
    const numeric = parseInt(String(signal.value), 10);
    if (!Number.isNaN(numeric)) count += numeric;
    const childTone = signal.tone ?? 'azure';
    if (tone === null || TONE_SEVERITY[childTone] > TONE_SEVERITY[tone]) tone = childTone;
  }
  if (!any) return null;
  return { count, tone: tone ?? 'azure' };
}

/**
 * Resolve a single active item key across pinned + every cluster item, so two
 * items sharing a base route (e.g. Capital Partners / Service Providers →
 * /partners) never both highlight. Longest base match wins; ties resolve to the
 * first item scanned (pinned first, then cluster order).
 */
function resolveActiveKey(pathname: string, fullPath: string): string | null {
  const flat: Array<{ key: string; href: string }> = [
    { key: 'pinned', href: RAIL_PINNED.href },
    ...RAIL_GROUPS.flatMap((g) => g.items.map((it, i) => ({ key: `${g.key}:${i}`, href: it.href })))
  ];
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
    if (group.secondary) return autoExpanded.has(group.key); // collapsed unless active/emphasized
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
            signal={signals?.badges?.[RAIL_PINNED.href]}
            onClick={onClose}
          />

          {RAIL_GROUPS.map((group) => {
            const extraTop = group.key === 'the-record' ? sourceOfTruthSummary : undefined;
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
      href={item.href}
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
            title={`${group.label} — combined signal`}
          >
            {rollup.count}
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
              {group.items.map((item, i) => {
                const itemKey = `${group.key}:${i}`;
                const active = activeKey === itemKey;
                const signal = badges?.[item.href] ?? badges?.[baseHref(item.href)];
                const Icon = item.icon;
                return (
                  <li key={itemKey}>
                    <Link
                      href={item.href}
                      onClick={onLinkClick}
                      aria-current={active ? 'page' : undefined}
                      title={item.hint}
                      data-testid={`rail-link-${baseHref(item.href).replace(/^\//, '') || 'root'}${
                        item.href.includes('?')
                          ? `-${item.href.split('?')[1].replace(/[^a-z0-9]/gi, '')}`
                          : ''
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
                      <span className="flex-1">
                        {item.label}
                        {!item.live ? (
                          <span className="ml-1.5 text-[9.5px] font-semibold uppercase tracking-[0.11em] text-fg-5">
                            soon
                          </span>
                        ) : null}
                      </span>
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
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
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
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold leading-tight text-gold-1">
          {launcher.label}
        </span>
        {launcher.verbs ? (
          <span className="mt-0.5 block truncate text-[10px] leading-tight text-gold-1/70">
            {launcher.verbs}
          </span>
        ) : null}
      </span>
      <Sparkles size={12} strokeWidth={2} aria-hidden className="flex-none text-gold-1/70" />
    </motion.button>
  );
}

export default Wave1SideRail;
