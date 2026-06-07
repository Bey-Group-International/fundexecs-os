'use client';

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { AccountMenu } from './account/AccountMenu';
import type { LifecycleStage } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';
import {
  RAIL_GROUPS,
  STAGE_TO_GROUP_KEYS,
  type RailGroupKey,
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
 * Re-exports — keep the registry types reachable from the historical module
 * path so existing importers (AppShell, dashboard-rail-signals) don't break.
 * --------------------------------------------------------------------------*/

export { RAIL_GROUPS, STAGE_TO_GROUP_KEYS };
export type { RailGroupKey, RailNavGroup, RailNavItem };

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
  /** Optional card the rail mounts at the top of the "Source of Truth" group.
   *  Wave-1: typically `<FundProfileRailSummary>` server-rendered upstream. */
  sourceOfTruthSummary?: ReactNode;
  /** Override default sign-out (defaults to Supabase client signOut). */
  onSignOut?: () => void | Promise<void>;
}

/* ----------------------------------------------------------------------------
 * Rollup helpers
 * --------------------------------------------------------------------------*/

/**
 * Severity ranking for badge tones — used to pick a group rollup's tone from
 * its highest-severity child badge. Higher number = more urgent.
 */
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
  /** Summed numeric count across the group's item badges. */
  count: number;
  /** Tone of the highest-severity child badge. */
  tone: BadgeTone;
}

/**
 * Compute a per-group rollup from the existing per-item `signals.badges`
 * (no loader change). The count sums the numeric portion of each child badge
 * value (e.g. "78%" → 78, "12" → 12); non-numeric values contribute 0. The
 * tone follows the highest-severity child badge present in the group.
 */
function computeGroupRollup(
  group: RailNavGroup,
  badges: Record<string, RailSignal> | undefined
): GroupRollup | null {
  if (!badges) return null;
  let count = 0;
  let tone: BadgeTone | null = null;
  let any = false;
  for (const item of group.items) {
    const signal = badges[item.href];
    if (!signal) continue;
    any = true;
    const numeric = parseInt(String(signal.value), 10);
    if (!Number.isNaN(numeric)) count += numeric;
    const childTone = signal.tone ?? 'azure';
    if (tone === null || TONE_SEVERITY[childTone] > TONE_SEVERITY[tone]) {
      tone = childTone;
    }
  }
  if (!any) return null;
  return { count, tone: tone ?? 'azure' };
}

/** Find the group whose item owns the active route, if any. */
function findActiveGroupKey(pathname: string): RailGroupKey | null {
  for (const group of RAIL_GROUPS) {
    const match = group.items.some(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
    );
    if (match) return group.key;
  }
  return null;
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
  // Stage-emphasized groups (React Compiler memoizes the derivation).
  const emphasizedGroups = signals?.currentStage
    ? new Set<RailGroupKey>(STAGE_TO_GROUP_KEYS[signals.currentStage])
    : new Set<RailGroupKey>();

  // The group that owns the active route.
  const activeGroupKey = findActiveGroupKey(pathname);

  /**
   * Auto-expand baseline: the active group + every stage-emphasized group.
   * Manual overrides win on top.
   */
  const autoExpanded = new Set<RailGroupKey>(emphasizedGroups);
  if (activeGroupKey) autoExpanded.add(activeGroupKey);

  // Manual expand/collapse overrides — read from the external store so the
  // server snapshot is empty (no hydration mismatch) and writes re-render.
  const overrides = useSyncExternalStore(
    subscribeRailCollapse,
    getRailCollapseSnapshot,
    getRailCollapseServerSnapshot
  );

  function isExpanded(key: RailGroupKey): boolean {
    const manual = overrides[key];
    if (typeof manual === 'boolean') return manual;
    return autoExpanded.has(key);
  }

  function toggleGroup(key: RailGroupKey) {
    writeRailCollapseState(key, !isExpanded(key));
  }

  async function defaultSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  async function handleSignOut() {
    if (onSignOut) {
      await onSignOut();
      return;
    }
    await defaultSignOut();
  }

  return (
    <aside
      data-testid="wave1-side-rail"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-full w-[252px] flex-none flex-col border-r border-hairline bg-bg-1 transition-transform duration-200 lg:static lg:z-10 lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-[18px] pb-3 pt-[18px]">
        <span
          aria-hidden
          className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-[15px] font-bold text-[#070b14]"
        >
          F
        </span>
        <div className="flex-1 text-[15px] font-semibold tracking-[-0.02em]">
          FundExecs <span className="font-medium text-fg-4">OS</span>
        </div>
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

      {/* Nav — six collapsible logic-area compartments.
          The former top-of-rail org switcher is consolidated into the account
          menu in the footer (single identity hub). */}
      <nav
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2"
        data-testid="side-rail-nav"
      >
        {RAIL_GROUPS.map((group) => {
          const extraTop = group.key === 'source-of-truth' ? sourceOfTruthSummary : undefined;
          return (
            <NavGroup
              key={group.key}
              group={group}
              pathname={pathname}
              emphasized={emphasizedGroups.has(group.key)}
              expanded={isExpanded(group.key)}
              onToggle={() => toggleGroup(group.key)}
              rollup={computeGroupRollup(group, signals?.badges)}
              badges={signals?.badges}
              onLinkClick={onClose}
              extraTop={extraTop}
            />
          );
        })}
      </nav>

      {/* User footer — the popping account menu (identity, workspace/role
          switch, settings/admin/integrations/plans/gift/help/learn-more, and
          log out). Replaces the old static footer + sign-out icon. */}
      <div data-testid="side-rail-user-footer">
        <AccountMenu identity={identity} onSignOut={handleSignOut} onNavigate={onClose} />
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------------------------
 * Subcomponents
 * --------------------------------------------------------------------------*/

interface NavGroupProps {
  group: RailNavGroup;
  pathname: string;
  emphasized: boolean;
  expanded: boolean;
  onToggle: () => void;
  rollup: GroupRollup | null;
  badges?: Record<string, RailSignal>;
  onLinkClick: () => void;
  /** Optional node rendered between the group heading and the link list.
   *  Used for FundProfileRailSummary on the source-of-truth group. */
  extraTop?: ReactNode;
}

function NavGroup({
  group,
  pathname,
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

  // Scroll the emphasized (stage-owned) compartment into view on load so the
  // attention-routing hint is visible even in a long rail.
  useEffect(() => {
    if (emphasized && expanded) {
      headerRef.current?.scrollIntoView({ block: 'nearest' });
    }
    // Run only when stage emphasis is first established for this group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emphasized]);

  return (
    <section
      data-testid={`rail-group-${group.key}`}
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
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden
          className={cn(
            'flex-none text-fg-5 transition-transform duration-200 motion-reduce:transition-none',
            expanded ? 'rotate-0' : '-rotate-90'
          )}
        />
      </button>

      {/* Panel */}
      <div id={panelId} hidden={!expanded}>
        {extraTop ? <div className="px-2.5 pb-1.5 pt-0.5">{extraTop}</div> : null}
        <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const signal = badges?.[item.href];
            const Icon = item.icon;
            return (
              <li key={`${group.key}-${item.href}`}>
                <Link
                  href={item.href}
                  onClick={onLinkClick}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`rail-link-${item.href.replace(/^\//, '') || 'root'}`}
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
      </div>
    </section>
  );
}

export default Wave1SideRail;
