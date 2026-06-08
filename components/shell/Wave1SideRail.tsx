'use client';

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  ArrowRight,
  ChevronDown,
  Compass,
  Gauge,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { AccountMenu } from './account/AccountMenu';
import type { LifecycleStage } from '@/lib/lifecycle';
import { LINK_STATE_LABEL, type LinkState, type LoopChain, type LoopLink } from '@/lib/loop-chain';
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
import {
  getGuidedServerSnapshot,
  getGuidedSnapshot,
  setGuidedOn,
  subscribeGuided
} from './guided/guided-storage';

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
  /**
   * Phase 4: the loop as a chain — Build → Source → Run → Drive rendered as a
   * connected sequence where the active link charges the next. When present,
   * the spine shows the chain strip and clusters pick up their link state.
   */
  chain?: LoopChain;
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
  /** Pre-formatted headline — a compact $ total, e.g. "$4.2M". */
  label: string;
  tone: BadgeTone;
}

/** Strip a query string for pathname matching. */
function baseHref(href: string): string {
  return href.split('?')[0];
}

/**
 * Compute a per-cluster rollup from the per-item `signals.badges`. Only badges
 * carrying a raw `amount` (value-at-stake $) roll up: they sum to a compact
 * dollar figure and the highest-severity one sets the tone. Score/percentage
 * badges (Profile %, readiness/execution scores) are deliberately ignored —
 * summing them is meaningless — so a cluster with no $ at stake shows no rollup.
 */
function computeGroupRollup(
  group: RailNavGroup,
  badges: Record<string, RailSignal> | undefined
): GroupRollup | null {
  if (!badges) return null;
  let dollars = 0;
  let hasDollars = false;
  let tone: BadgeTone | null = null;
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
    const amount = signal.amount;
    // Require a positive, finite amount — `amount <= 0` alone wouldn't reject
    // NaN/Infinity (every NaN comparison is false), and one NaN would poison the
    // whole sum into a misleading "$0".
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) continue;
    dollars += amount;
    hasDollars = true;
    const childTone = signal.tone ?? 'azure';
    if (tone === null || TONE_SEVERITY[childTone] > TONE_SEVERITY[tone]) tone = childTone;
  }
  return hasDollars ? { label: compactMoney(dollars), tone: tone ?? 'azure' } : null;
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

  // The operating spine is a collapsible section too (default open). Persisted
  // under the `momentum` pseudo-key so operators can reclaim its vertical space.
  const spineExpanded = typeof overrides.momentum === 'boolean' ? overrides.momentum : true;
  function toggleSpine() {
    writeRailCollapseState('momentum', !spineExpanded);
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
            <EarnCoin size={26} className="flex-none" />
            <span className="text-[12px] font-semibold tracking-[-0.02em]">
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
          className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-2"
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
            <MomentumSpine
              momentum={signals.momentum}
              expanded={spineExpanded}
              onToggle={toggleSpine}
              onLinkClick={onClose}
            />
          ) : null}

          {RAIL_GROUPS.map((group) => {
            const extraTop = group.key === 'build' ? sourceOfTruthSummary : undefined;
            // The chain verbs share the cluster keys, so a link maps 1:1 to a
            // group. When closing (Drive active), Build is the wrap target.
            const chain = signals?.momentum?.chain;
            const link = chain?.links.find((l) => l.verb === group.key);
            const chainState: LinkState | undefined =
              link && chain?.closing && group.key === 'build' ? 'on_deck' : link?.state;
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
                chainState={chainState}
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
        'relative flex items-center gap-3 rounded-[12px] border px-2.5 py-2.5 text-[12px] font-semibold transition-[background,box-shadow,transform] will-change-transform motion-reduce:transition-none',
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
  /** This cluster's position in the loop chain (Phase 4), if a chain is live. */
  chainState?: LinkState;
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
  chainState,
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
      {/* Collapsible header — toggle + a small pop-out Earn launcher beside it. */}
      <div
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-2 transition-[background] hover:bg-surface-1',
          emphasized ? 'text-gold-1' : 'text-fg-4'
        )}
      >
        <button
          type="button"
          ref={headerRef}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          data-testid={`rail-group-toggle-${group.key}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1"
        >
          <GroupIcon size={14} strokeWidth={1.9} aria-hidden className="flex-none" />
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.06em]">
            {group.label}
          </span>
          {chainState ? <ChainPip state={chainState} /> : null}
        </button>
        {rollup ? (
          <Badge
            tone={rollup.tone}
            className="px-1.5 py-0.5 text-[10px] tabular-nums"
            title={`${group.label} — ${rollup.label} at stake`}
          >
            {rollup.label}
          </Badge>
        ) : null}
        <ClusterMenu group={group} onLinkClick={onLinkClick} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.label}`}
          className="flex-none rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1"
        >
          <motion.span
            className="block"
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={FX_SPRING}
          >
            <ChevronDown size={14} strokeWidth={2} aria-hidden className="flex-none text-fg-5" />
          </motion.span>
        </button>
      </div>

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
            {/* Subsections first — the navigable links sit right under the
                header so they're the easiest thing to reach on expand. */}
            <ul className="flex flex-col gap-0.5 px-1.5 pb-1 pt-1.5">
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
            {extraTop ? <div className="px-2.5 pb-2 pt-0.5">{extraTop}</div> : null}
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
          className="relative flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[12px] font-medium text-fg-3 transition-[background,transform] will-change-transform hover:translate-x-0.5 hover:bg-surface-1 motion-reduce:transition-none"
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
          className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[12px] font-medium text-fg-5"
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
          'relative flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[12px] font-medium transition-[background,box-shadow,transform] will-change-transform motion-reduce:transition-none motion-reduce:hover:translate-x-0',
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
        className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[12px] font-medium text-fg-3 transition-[background] hover:bg-surface-1"
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
                      className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[11px] text-fg-5"
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
                        'flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[11px] transition-[background] hover:bg-surface-1',
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
 *
 * Collapsible (default open): the readiness headline always shows in the header;
 * collapsing tucks the bar, loop position, next move, chain, and guided launch
 * away so operators can reclaim the vertical space. State persists per the
 * `momentum` pseudo-key.
 */
function MomentumSpine({
  momentum,
  expanded,
  onToggle,
  onLinkClick
}: {
  momentum: RailMomentum;
  expanded: boolean;
  onToggle: () => void;
  onLinkClick: () => void;
}) {
  const panelId = useId();
  const {
    loopProgress,
    readinessScore,
    stageLabel,
    stageIndex,
    stageCount,
    nextBestAction,
    chain
  } = momentum;
  return (
    <motion.div
      layout
      data-testid="rail-momentum"
      data-state={expanded ? 'open' : 'collapsed'}
      className="overflow-hidden rounded-[12px] border border-hairline bg-bg-1"
    >
      {/* Header — same chrome as the loop clusters: icon · label · chip · chevron. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid="rail-momentum-toggle"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-fg-4 transition-[background] hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1"
      >
        <Gauge size={14} strokeWidth={1.9} aria-hidden className="flex-none" />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.06em]">
          Operating loop
        </span>
        <Badge
          tone="azure"
          className="px-1.5 py-0.5 text-[10px] tabular-nums"
          title={`Readiness ${readinessScore}/100`}
        >
          {readinessScore}
        </Badge>
        <motion.span animate={{ rotate: expanded ? 0 : -90 }} transition={FX_SPRING}>
          <ChevronDown size={14} strokeWidth={2} aria-hidden className="flex-none text-fg-5" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={panelId}
            key="spine-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: FX_EASE }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5">
              <div
                className="h-1 overflow-hidden rounded-full bg-hairline"
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
                <span className="font-medium text-fg-2">{stageLabel}</span> · stage {stageIndex + 1}
                /{stageCount} · loop {loopProgress}%
              </p>
              {nextBestAction ? (
                <Link
                  href={nextBestAction.href}
                  onClick={onLinkClick}
                  data-testid="rail-next-action"
                  title={`${nextBestAction.cta}: ${nextBestAction.title}`}
                  className="mt-2 flex items-center gap-1.5 rounded-[9px] border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2 py-1.5 text-[11px] font-semibold text-azure-1 transition-transform hover:translate-x-0.5"
                >
                  <span className="text-[8.5px] uppercase tracking-[0.1em] text-azure-1/70">
                    Next
                  </span>
                  <span className="min-w-0 flex-1 truncate">{nextBestAction.title}</span>
                  <ArrowRight size={12} strokeWidth={2.4} aria-hidden className="flex-none" />
                </Link>
              ) : null}
              {chain ? <LoopChainStrip chain={chain} /> : null}
              {chain ? <GuidedLaunch /> : null}
            </div>
          </motion.div>
        ) : (
          // Collapsed: keep the operator's loop position visible at a glance.
          <p className="px-2.5 pb-2 text-[10px] text-fg-4">
            <span className="font-medium text-fg-2">{stageLabel}</span> · loop {loopProgress}%
          </p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The guided-mode launch control under the chain — engages the hand-on-the-
 * wheel walkthrough (Phase 5). Reflects the persisted on-state so the rail and
 * the overlay stay in sync. Only rendered when a loop chain is live.
 */
function GuidedLaunch() {
  const guided = useSyncExternalStore(subscribeGuided, getGuidedSnapshot, getGuidedServerSnapshot);
  return (
    <button
      type="button"
      onClick={() => setGuidedOn(!guided.on)}
      aria-pressed={guided.on}
      data-testid="rail-guided-launch"
      className={cn(
        'mt-2 flex w-full items-center justify-center gap-1.5 rounded-[9px] border px-2 py-1.5 text-[11px] font-semibold transition-[background,transform] hover:translate-x-0.5',
        guided.on
          ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
          : 'border-hairline text-fg-3 hover:bg-surface-1'
      )}
    >
      <Compass size={12} strokeWidth={2.2} aria-hidden className="flex-none" />
      <span>{guided.on ? 'Guided on — walking the loop' : 'Guide me through the loop'}</span>
    </button>
  );
}

/* ----------------------------------------------------------------------------
 * Loop chain (Phase 4) — the four verbs as a charging sequence.
 * --------------------------------------------------------------------------*/

/**
 * The chain strip pinned under the next-best-action: Build → Source → Run →
 * Drive as connected nodes. The active link is lit, the link it's about to
 * unlock reads "on deck", cleared links read charged, and the connector after
 * the active link fills with today's action-completion charge. A handoff line
 * names the move ("Clear diligence → arms Drive"); when the loop has compounded
 * at least once, a capstone line names what the close fed forward.
 */
function LoopChainStrip({ chain }: { chain: LoopChain }) {
  return (
    <div className="mt-2.5 border-t border-hairline pt-2" data-testid="rail-loop-chain">
      <div className="flex items-start">
        {chain.links.map((link, i) => {
          // When the loop is closing (Drive active), Build is the wrap target —
          // render it "on deck" so the chain visibly points back to the start.
          const effState: LinkState =
            chain.closing && link.verb === 'build' ? 'on_deck' : link.state;
          return (
            <Fragment key={link.verb}>
              <ChainNode label={link.label} state={effState} />
              {i < chain.links.length - 1 ? (
                <ChainConnector fill={connectorFill(link, chain.charge)} />
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <p className="mt-2 flex items-start gap-1 text-[10px] leading-snug text-fg-3">
        <ArrowRight
          size={11}
          strokeWidth={2.4}
          aria-hidden
          className="mt-[1px] flex-none text-azure-1"
        />
        <span className="min-w-0 flex-1">{chain.handoff}</span>
      </p>
      {chain.capstone ? (
        <p
          data-testid="rail-loop-capstone"
          className={cn(
            'mt-1.5 flex items-start gap-1 text-[10px] leading-snug',
            chain.closing ? 'text-gold-1' : 'text-fg-4'
          )}
        >
          <RefreshCw
            size={11}
            strokeWidth={2.2}
            aria-hidden
            className={cn('mt-[1px] flex-none', chain.closing ? 'text-gold-1' : 'text-fg-4')}
          />
          <span className="min-w-0 flex-1">{chain.capstone}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Fill for the connector trailing a link: cleared links flow full; the active
 *  link fills with its charge; downstream links are empty. */
function connectorFill(link: LoopLink, activeCharge: number): number {
  if (link.state === 'cleared') return 1;
  if (link.state === 'active') return activeCharge;
  return 0;
}

const CHAIN_DOT: Record<LinkState, string> = {
  cleared: 'bg-success',
  active: 'bg-azure-1 ring-2 ring-azure-1/30',
  on_deck: 'border border-azure-1 bg-transparent motion-safe:animate-pulse',
  waiting: 'bg-fg-5/40'
};

const CHAIN_TEXT: Record<LinkState, string> = {
  cleared: 'text-success/80',
  active: 'font-semibold text-azure-1',
  on_deck: 'text-azure-1/70',
  waiting: 'text-fg-5'
};

/** One verb node in the chain strip: a state-toned dot with a label beneath. */
function ChainNode({ label, state }: { label: string; state: LinkState }) {
  return (
    <div
      className="flex flex-none flex-col items-center gap-1"
      title={`${label} · ${LINK_STATE_LABEL[state]}`}
      data-testid={`rail-chain-node-${label.toLowerCase()}`}
      data-state={state}
    >
      <span className={cn('h-2 w-2 rounded-full', CHAIN_DOT[state])} aria-hidden />
      <span
        className={cn('text-[8px] font-semibold uppercase tracking-[0.08em]', CHAIN_TEXT[state])}
      >
        {label}
      </span>
    </div>
  );
}

/** The track between two nodes; `fill` (0–1) is the charge that has flowed. */
function ChainConnector({ fill }: { fill: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, fill)) * 100);
  return (
    <div className="mx-1 mt-[3px] h-px flex-1 overflow-hidden rounded-full bg-hairline" aria-hidden>
      <div className="h-full rounded-full bg-azure-1" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The cluster-header chain pip — an ambient state cue so the whole rail reads as
 * a charging loop. Active needs no pip (the gold heading already carries it);
 * cleared shows a quiet success dot, on-deck a pulsing azure dot ("next to
 * unlock"), and waiting stays silent to keep the rail calm.
 */
function ChainPip({ state }: { state: LinkState }) {
  if (state === 'cleared') {
    return (
      <span
        className="h-1.5 w-1.5 flex-none rounded-full bg-success"
        title={LINK_STATE_LABEL.cleared}
        data-testid="rail-chain-pip-cleared"
        aria-hidden
      />
    );
  }
  if (state === 'on_deck') {
    return (
      <span
        className="h-1.5 w-1.5 flex-none rounded-full bg-azure-1 motion-safe:animate-pulse"
        title={LINK_STATE_LABEL.on_deck}
        data-testid="rail-chain-pip-ondeck"
        aria-hidden
      />
    );
  }
  return null;
}

/**
 * ClusterMenu — a small "more" affordance in the cluster header that pops out
 * the cluster's *full* option set: every nav link (flattening nested groups
 * like Capital → Equity/Debt/Hybrid so nothing is buried), plus the Earn
 * launcher action at the foot. Fixed-positioned beside the rail so the rail's
 * overflow never clips it; closes on outside-click / Escape / scroll.
 */
function ClusterMenu({ group, onLinkClick }: { group: RailNavGroup; onLinkClick: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  function toggle() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top, left: r.right + 8 });
    setOpen((v) => !v);
  }

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${group.label} — all options`}
        aria-label={`${group.label} options`}
        data-testid={`rail-cluster-menu-${group.key}`}
        className={cn(
          'flex h-5 w-5 flex-none items-center justify-center rounded-md text-fg-4 transition-[background] hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-1',
          open && 'bg-surface-2 text-fg-1'
        )}
      >
        <MoreHorizontal size={14} strokeWidth={2} aria-hidden />
      </button>
      <AnimatePresence>
        {open && pos ? (
          <motion.div
            role="menu"
            data-testid={`rail-cluster-menu-popover-${group.key}`}
            style={{ top: pos.top, left: pos.left }}
            initial={{ opacity: 0, x: -4, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.98 }}
            transition={FX_SPRING}
            className="fixed z-50 max-h-[70vh] w-60 overflow-y-auto rounded-[12px] border border-hairline bg-bg-1 p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.5)]"
          >
            {group.items.map((item, i) => (
              <ClusterMenuEntry
                key={`${group.key}-menu-${i}`}
                item={item}
                onLinkClick={onLinkClick}
                onClose={close}
              />
            ))}
            {group.launcher ? (
              <>
                <div className="my-1 h-px bg-hairline" aria-hidden />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    openEarn(group.launcher!.prompt);
                    close();
                    onLinkClick();
                  }}
                  className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left transition-[background] hover:bg-[var(--gold-soft)]"
                >
                  <Sparkles
                    size={13}
                    strokeWidth={2}
                    aria-hidden
                    className="flex-none text-gold-1"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gold-1">
                    {group.launcher.label}
                  </span>
                </button>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

/** One entry in a ClusterMenu — a link, an Earn action, a nested group of
 *  links (flattened under a label), or a muted "soon" row. */
function ClusterMenuEntry({
  item,
  onLinkClick,
  onClose
}: {
  item: RailNavItem;
  onLinkClick: () => void;
  onClose: () => void;
}) {
  const Icon = item.icon;
  const rowBase =
    'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[12px] transition-[background]';

  // Nested group (e.g. Capital → Equity/Debt/Hybrid): show every child link.
  if (item.children && item.children.length > 0) {
    return (
      <div>
        <p className="px-2.5 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-fg-5">
          {item.label}
        </p>
        {item.children.map((sub, j) =>
          sub.href && sub.live !== false ? (
            <Link
              key={j}
              href={sub.href}
              role="menuitem"
              onClick={() => {
                onLinkClick();
                onClose();
              }}
              className={cn(rowBase, 'pl-7 text-fg-3 hover:bg-surface-1')}
            >
              <span className="min-w-0 flex-1 truncate">{sub.label}</span>
            </Link>
          ) : (
            <div key={j} className={cn(rowBase, 'pl-7 text-fg-5')}>
              <span className="min-w-0 flex-1 truncate">{sub.label}</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.06em]">soon</span>
            </div>
          )
        )}
      </div>
    );
  }

  // Earn-action entry.
  if (item.earnPrompt) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          openEarn(item.earnPrompt as string);
          onClose();
          onLinkClick();
        }}
        className={cn(rowBase, 'text-fg-3 hover:bg-surface-1')}
      >
        <Icon size={14} strokeWidth={1.9} aria-hidden className="flex-none text-gold-1" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <Sparkles size={11} strokeWidth={2} aria-hidden className="flex-none text-gold-1/70" />
      </button>
    );
  }

  // "Soon" — not yet built.
  if (!item.href) {
    return (
      <div className={cn(rowBase, 'text-fg-5')}>
        <Icon size={14} strokeWidth={1.9} aria-hidden className="flex-none" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.06em]">soon</span>
      </div>
    );
  }

  // Normal route link.
  return (
    <Link
      href={item.href}
      role="menuitem"
      onClick={() => {
        onLinkClick();
        onClose();
      }}
      className={cn(rowBase, 'text-fg-2 hover:bg-surface-1')}
    >
      <Icon size={14} strokeWidth={1.9} aria-hidden className="flex-none text-fg-4" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  );
}

export default Wave1SideRail;
