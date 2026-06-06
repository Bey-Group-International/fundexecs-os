'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  // Source of Truth
  ShieldCheck,
  IdCard,
  // Daily Execution
  LayoutDashboard,
  ListChecks,
  Inbox,
  // Capital Formation
  TrendingUp,
  Layers,
  MessagesSquare,
  // Deal Execution
  Briefcase,
  FileSignature,
  Scale,
  // Intelligence
  Mail,
  BookOpenText,
  FilePlus,
  Handshake,
  // Audit
  History,
  X,
  ChevronsUpDown,
  LogOut,
  type LucideIcon
} from 'lucide-react';
import { Avatar, Badge, type BadgeTone } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import type { LifecycleStage } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------------*/

/** One rail entry inside a logic-area group. */
export interface RailNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** True for routes that ship UI in Wave 1; stubs are routed but flagged. */
  live?: boolean;
}

/** One logic-area group from the spec — the rail's six top-level sections. */
export interface RailNavGroup {
  /** Stable key — used to look up stage emphasis. */
  key:
    | 'source-of-truth'
    | 'daily-execution'
    | 'capital-formation'
    | 'deal-execution'
    | 'intelligence'
    | 'audit';
  label: string;
  /** One-line description shown under the group label on the rail. */
  description?: string;
  items: RailNavItem[];
}

/** Live-signal payload the rail accepts — keyed by item `href`. */
export interface RailSignal {
  /** Pre-formatted value (e.g. "12", "78%"). */
  value: string | number;
  tone?: BadgeTone;
  /** Hover hint on the badge. */
  hint?: string;
}

export interface NavSignals {
  /** Current lifecycle stage — drives the subtle gold emphasis on the area
   *  group whose modules own this stage's work. */
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
 * Default IA — the six logic-area groups from the spec
 * --------------------------------------------------------------------------*/

export const RAIL_GROUPS: RailNavGroup[] = [
  {
    key: 'source-of-truth',
    label: 'Source of Truth',
    description: 'The canonical record everything reads from.',
    items: [
      { href: '/profile', label: 'Fund Profile', icon: IdCard, live: true },
      { href: '/trust', label: 'Trust Center', icon: ShieldCheck }
    ]
  },
  {
    key: 'daily-execution',
    label: 'Daily Execution',
    description: "Today's loop — where you are, what's next.",
    items: [
      { href: '/command-center', label: 'Dashboard', icon: LayoutDashboard, live: true },
      { href: '/action-queue', label: 'Action Queue', icon: ListChecks },
      { href: '/match-inbox', label: 'Match Inbox', icon: Inbox }
    ]
  },
  {
    key: 'capital-formation',
    label: 'Capital Formation',
    description: 'Build your LP universe and close the raise.',
    items: [
      { href: '/pipeline', label: 'LP Pipeline', icon: TrendingUp, live: true },
      { href: '/capital-stack', label: 'Capital Stack', icon: Layers },
      { href: '/objections', label: 'Objections', icon: MessagesSquare }
    ]
  },
  {
    key: 'deal-execution',
    label: 'Deal Execution',
    description: 'Source, diligence, decide, deploy.',
    items: [
      { href: '/deal-desk', label: 'Deal Desk', icon: Briefcase },
      { href: '/ic-memos', label: 'IC Memos', icon: FileSignature },
      { href: '/governance', label: 'Governance', icon: Scale }
    ]
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    description: 'Signal in. Knowledge out. Materials ready.',
    items: [
      { href: '/inbox-intelligence', label: 'Inbox Intelligence', icon: Mail },
      { href: '/knowledge', label: 'Knowledge Base', icon: BookOpenText },
      { href: '/materials', label: 'Capital Materials', icon: FilePlus },
      { href: '/partners', label: 'Partner Marketplace', icon: Handshake }
    ]
  },
  {
    key: 'audit',
    label: 'Audit',
    description: 'Every action provable. Every decision reusable.',
    items: [
      { href: '/trust', label: 'Trust Center', icon: ShieldCheck },
      { href: '/audit', label: 'Memory Audit Trail', icon: History }
    ]
  }
];

/**
 * Map each lifecycle stage to the rail group(s) it primarily emphasizes. Used
 * for the subtle gold pulse on the area-group heading when `signals.currentStage`
 * is set. Per the spec, the rail is an attention router — emphasis is a hint,
 * never a hard-coded "you must click here next."
 */
const STAGE_TO_GROUP_KEYS: Record<LifecycleStage, readonly RailNavGroup['key'][]> = {
  establish_truth: ['source-of-truth'],
  get_raise_ready: ['source-of-truth', 'intelligence'],
  source_lps: ['capital-formation'],
  convert_lps: ['capital-formation'],
  source_deals: ['deal-execution'],
  operate: ['daily-execution', 'intelligence'],
  prove: ['audit']
};

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
    ? new Set(STAGE_TO_GROUP_KEYS[signals.currentStage])
    : new Set<RailNavGroup['key']>();

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

      {/* Org switcher */}
      <div className="px-3 pb-2">
        <button
          type="button"
          data-testid="side-rail-org-switcher"
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-hairline bg-surface-1 px-2.5 py-2 transition-[background,box-shadow] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
        >
          <Avatar name={identity.orgName} size={26} tone="gold" />
          <div className="flex-1 overflow-hidden text-left">
            <div className="truncate text-[12.5px] font-semibold text-fg-1">{identity.orgName}</div>
            <div className="truncate text-[10.5px] text-fg-4">{identity.orgTier}</div>
          </div>
          <ChevronsUpDown size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
        </button>
      </div>

      {/* Nav — six logic-area groups */}
      <nav
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-2"
        data-testid="side-rail-nav"
      >
        {RAIL_GROUPS.map((group) => {
          const emphasized = emphasizedGroups.has(group.key);
          const extraTop = group.key === 'source-of-truth' ? sourceOfTruthSummary : undefined;
          return (
            <NavGroup
              key={group.key}
              group={group}
              pathname={pathname}
              emphasized={emphasized}
              badges={signals?.badges}
              onLinkClick={onClose}
              extraTop={extraTop}
            />
          );
        })}
      </nav>

      {/* User footer */}
      <div
        className="m-3 flex items-center gap-2.5 rounded-[10px] border border-hairline px-2.5 py-2.5"
        data-testid="side-rail-user-footer"
      >
        <Avatar name={identity.name} size={30} />
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-[12.5px] font-semibold text-fg-1">{identity.name}</div>
          <div className="truncate text-[10.5px] text-fg-4">{identity.role}</div>
        </div>
        <Badge tone="gold" className="px-1.5 py-0.5 text-[10px]">
          L{identity.level}
        </Badge>
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
          data-testid="side-rail-signout-btn"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-fg-4 transition-[background,box-shadow] hover:bg-surface-1 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
        >
          <LogOut size={15} strokeWidth={1.9} aria-hidden />
        </button>
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
  badges?: Record<string, RailSignal>;
  onLinkClick: () => void;
  /** Optional node rendered between the group heading and the link list.
   *  Used for FundProfileRailSummary on the source-of-truth group. */
  extraTop?: ReactNode;
}

function NavGroup({ group, pathname, emphasized, badges, onLinkClick, extraTop }: NavGroupProps) {
  return (
    <section data-testid={`rail-group-${group.key}`}>
      <div
        className={cn(
          'mb-1 flex items-center gap-1.5 px-3',
          emphasized && 'text-gold-1',
          !emphasized && 'text-fg-5'
        )}
      >
        {emphasized ? (
          <span aria-hidden className="inline-flex h-1 w-1 animate-pulse rounded-full bg-gold-1" />
        ) : null}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{group.label}</span>
      </div>
      {extraTop ? <div className="mb-1.5 px-1">{extraTop}</div> : null}
      <ul className="flex flex-col gap-0.5">
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
                  'relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-[background,box-shadow,transform] will-change-transform',
                  active
                    ? 'bg-gradient-to-r from-[var(--azure-soft)] to-surface-1 text-fg-1'
                    : 'text-fg-3 hover:translate-x-0.5 hover:bg-surface-1'
                )}
              >
                {active ? (
                  <span
                    className="absolute -left-3 bottom-1.5 top-1.5 w-[3px] rounded-full bg-azure-1"
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
    </section>
  );
}

export default Wave1SideRail;
