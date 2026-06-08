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
  PieChart,
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
  type LucideIcon
} from 'lucide-react';
import type { LifecycleStage } from '@/lib/lifecycle';

/* ----------------------------------------------------------------------------
 * Rail navigation registry — the single source of truth for the side rail.
 *
 * The component (`Wave1SideRail.tsx`) renders entirely from this module: groups,
 * items, `live`/`soon` flags, group header icons, and the stage→group emphasis
 * map. Keeping this declarative and centralized means flag/IA changes happen in
 * one place and never drift between the loader and the view.
 *
 * Scope guardrail: this is UI metadata only. It must not import from
 * `lib/queries/*`, `lib/supabase/*`, or touch any loader.
 * --------------------------------------------------------------------------*/

/** Stable group keys — used to look up stage emphasis + persistence state. */
export type RailGroupKey =
  | 'source-of-truth'
  | 'daily-execution'
  | 'capital-formation'
  | 'deal-execution'
  | 'intelligence'
  | 'audit';

/** One rail entry inside a logic-area group. */
export interface RailNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** True for routes that ship UI in Wave 1; stubs are routed but flagged. */
  live?: boolean;
}

/** One logic-area group — the rail's six top-level compartments. */
export interface RailNavGroup {
  key: RailGroupKey;
  label: string;
  /** Group header icon — gives each compartment a scannable identity. */
  icon: LucideIcon;
  /** One-line description shown under the group label on the rail. */
  description?: string;
  items: RailNavItem[];
}

/**
 * The six logic-area compartments.
 *
 * `live` flags reflect shipped UI as of #93/#95/#98:
 *  - LIVE: match-inbox, capital-stack, objections, inbox-intelligence, partners,
 *    audit (and prior live items)
 *  - SOON: materials (preview only — full UI not shipped)
 *
 * Trust Center is de-duped: it lives in Source of Truth only. Audit keeps just
 * the Memory Audit Trail (`/audit`).
 */
export const RAIL_GROUPS: readonly RailNavGroup[] = [
  {
    key: 'source-of-truth',
    label: 'Source of Truth',
    icon: ShieldCheck,
    description: 'The canonical record everything reads from.',
    items: [
      { href: '/profile', label: 'Profile', icon: IdCard, live: true },
      { href: '/trust', label: 'Trust Center', icon: ShieldCheck, live: true }
    ]
  },
  {
    key: 'daily-execution',
    label: 'Daily Execution',
    icon: LayoutDashboard,
    description: "Today's loop — where you are, what's next.",
    items: [
      { href: '/command-center', label: 'Dashboard', icon: LayoutDashboard, live: true },
      { href: '/action-queue', label: 'Action Queue', icon: ListChecks, live: true },
      { href: '/match-inbox', label: 'Match Inbox', icon: Inbox, live: true }
    ]
  },
  {
    key: 'capital-formation',
    label: 'Capital Formation',
    icon: TrendingUp,
    description: 'Build your LP universe and close the raise.',
    items: [
      { href: '/pipeline', label: 'LP Pipeline', icon: TrendingUp, live: true },
      { href: '/capital-stack', label: 'Capital Stack', icon: Layers, live: true },
      { href: '/cap-table', label: 'Cap Table', icon: PieChart, live: true },
      { href: '/objections', label: 'Objections', icon: MessagesSquare, live: true }
    ]
  },
  {
    key: 'deal-execution',
    label: 'Deal Execution',
    icon: Briefcase,
    description: 'Source, diligence, decide, deploy.',
    items: [
      { href: '/deal-desk', label: 'Deal Desk', icon: Briefcase, live: true },
      { href: '/ic-memos', label: 'IC Memos', icon: FileSignature, live: true },
      { href: '/governance', label: 'Governance', icon: Scale, live: true }
    ]
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    icon: Mail,
    description: 'Signal in. Knowledge out. Materials ready.',
    items: [
      { href: '/inbox-intelligence', label: 'Inbox Intelligence', icon: Mail, live: true },
      { href: '/knowledge', label: 'Knowledge Base', icon: BookOpenText, live: true },
      { href: '/materials', label: 'Capital Materials', icon: FilePlus },
      { href: '/partners', label: 'Partner Marketplace', icon: Handshake, live: true }
    ]
  },
  {
    key: 'audit',
    label: 'Audit',
    icon: History,
    description: 'Every action provable. Every decision reusable.',
    items: [{ href: '/audit', label: 'Memory Audit Trail', icon: History, live: true }]
  }
];

/**
 * Map each lifecycle stage to the rail group(s) it primarily emphasizes. Drives
 * stage-aware auto-expand + the subtle gold emphasis on the area heading when
 * `signals.currentStage` is set. Emphasis is a hint, never a hard requirement.
 */
export const STAGE_TO_GROUP_KEYS: Record<LifecycleStage, readonly RailGroupKey[]> = {
  establish_truth: ['source-of-truth'],
  get_raise_ready: ['source-of-truth', 'intelligence'],
  source_lps: ['capital-formation'],
  convert_lps: ['capital-formation'],
  source_deals: ['deal-execution'],
  operate: ['daily-execution', 'intelligence'],
  prove: ['audit']
};
