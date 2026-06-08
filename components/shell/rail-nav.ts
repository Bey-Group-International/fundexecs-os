import {
  // Pinned
  LayoutDashboard,
  // The Record
  ShieldCheck,
  IdCard,
  Gauge,
  Radar,
  // The Network
  Network,
  Briefcase,
  TrendingUp,
  Layers,
  Handshake,
  Wrench,
  // The Workshop
  Wand2,
  Sparkles,
  FileSignature,
  FileText,
  MessagesSquare,
  Megaphone,
  // Desk tools
  ListChecks,
  Inbox,
  MessageSquareWarning,
  PieChart,
  Scale,
  History,
  type LucideIcon
} from 'lucide-react';
import type { LifecycleStage } from '@/lib/lifecycle';

/* ----------------------------------------------------------------------------
 * Rail navigation registry — the single source of truth for the side rail.
 *
 * The rail is a BlackRock-grade command-center spine: a pinned Command Center,
 * three intentional clusters (record → network → produce), and a collapsed
 * "Desk Tools" drawer for lower-frequency surfaces. Each AI cluster carries one
 * Earn action launcher (a verb you trigger, not a page you hunt for).
 *
 * The component (`Wave1SideRail.tsx`) renders entirely from this module. Keeping
 * it declarative means IA/flag changes happen in one place.
 *
 * Scope guardrail: UI metadata only. Must not import from `lib/queries/*`,
 * `lib/supabase/*`, or any loader.
 * --------------------------------------------------------------------------*/

/** Stable group keys — used to look up stage emphasis + persisted collapse. */
export type RailGroupKey = 'the-record' | 'the-network' | 'the-workshop' | 'desk-tools';

/** One rail entry inside a cluster. */
export interface RailNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** True for routes that ship UI; stubs are routed but flagged "soon". */
  live?: boolean;
  /** Optional one-line value hint shown on hover (title attr). */
  hint?: string;
}

/** An Earn-powered action launcher pinned atop a cluster. */
export interface RailLauncher {
  label: string;
  icon: LucideIcon;
  /** The capability verbs, shown small beneath the label. */
  verbs?: string;
  /** Prompt seeded into the Earn dock when triggered. */
  prompt: string;
}

/** One cluster — the rail's top-level compartments. */
export interface RailNavGroup {
  key: RailGroupKey;
  label: string;
  /** Cluster header icon — gives each compartment a scannable identity. */
  icon: LucideIcon;
  /** One-line description shown under the cluster label. */
  description?: string;
  /** Earn action launcher for this cluster (optional). */
  launcher?: RailLauncher;
  /** Lower-frequency clusters start collapsed regardless of active state. */
  secondary?: boolean;
  items: RailNavItem[];
}

/**
 * Command Center — pinned above the clusters. The dashboard / home overview.
 */
export const RAIL_PINNED: RailNavItem = {
  href: '/command-center',
  label: 'Command Center',
  icon: LayoutDashboard,
  live: true,
  hint: 'Your live operating picture'
};

/**
 * The clusters. Existing routes are folded in and renamed in the FundExecs OS
 * house voice. Where two labels share a base route (Capital Partners / Service
 * Providers → /partners), the href carries a `lens` query so the link is
 * distinct and the destination can filter later.
 */
export const RAIL_GROUPS: readonly RailNavGroup[] = [
  {
    key: 'the-record',
    label: 'The Record',
    icon: ShieldCheck,
    description: 'The source of truth every counterparty reads from.',
    launcher: {
      label: 'Source & Match',
      icon: Radar,
      verbs: 'Earn finds & matches counterparties to your record',
      prompt:
        'Source new LPs and deals that fit my thesis, and match them against my record. Show me the strongest fits and why.'
    },
    items: [
      {
        href: '/profile',
        label: 'Profile',
        icon: IdCard,
        live: true,
        hint: 'Your canonical record'
      },
      {
        href: '/profile?view=readiness',
        label: 'Capital Readiness',
        icon: Gauge,
        live: true,
        hint: 'How investable you are, today'
      },
      {
        href: '/trust',
        label: 'Chain of Trust',
        icon: ShieldCheck,
        live: true,
        hint: 'Proof, layer by layer'
      }
    ]
  },
  {
    key: 'the-network',
    label: 'The Network',
    icon: Network,
    description: 'Every relationship that funds you.',
    items: [
      {
        href: '/deal-desk',
        label: 'Deals',
        icon: Briefcase,
        live: true,
        hint: 'Source, diligence, decide'
      },
      {
        href: '/pipeline',
        label: 'LPs',
        icon: TrendingUp,
        live: true,
        hint: 'Your LP universe + pipeline'
      },
      {
        href: '/capital-stack',
        label: 'Capital Stack',
        icon: Layers,
        live: true,
        hint: 'The raise, by the dollar'
      },
      {
        href: '/partners?lens=capital',
        label: 'Capital Partners',
        icon: Handshake,
        live: true,
        hint: 'Co-investors & capital relationships'
      },
      {
        href: '/partners?lens=service',
        label: 'Service Providers',
        icon: Wrench,
        live: true,
        hint: 'Legal, audit, fund admin & more'
      }
    ]
  },
  {
    key: 'the-workshop',
    label: 'The Workshop',
    icon: Wand2,
    description: 'Turn raw inputs into closing-ready output.',
    launcher: {
      label: 'Run the Workshop',
      icon: Sparkles,
      verbs: 'Analyze · Plan · Organize · Produce',
      prompt:
        'Analyze what I have, plan the next deliverable, organize the inputs, and produce a first draft. What should we build first?'
    },
    items: [
      {
        href: '/ic-memos',
        label: 'Diligence & IC',
        icon: FileSignature,
        live: true,
        hint: 'Memos & decisions'
      },
      {
        href: '/knowledge',
        label: 'Documents',
        icon: FileText,
        live: true,
        hint: 'Your knowledge base'
      },
      {
        href: '/inbox-intelligence',
        label: 'Communications',
        icon: MessagesSquare,
        live: true,
        hint: 'Inbound signal, triaged'
      },
      {
        href: '/materials',
        label: 'Capital Materials',
        icon: Megaphone,
        live: true,
        hint: 'Decks, memos, one-pagers'
      }
    ]
  },
  {
    key: 'desk-tools',
    label: 'Desk Tools',
    icon: Wrench,
    description: 'Everything else, one click away.',
    secondary: true,
    items: [
      { href: '/action-queue', label: 'Action Queue', icon: ListChecks, live: true },
      { href: '/match-inbox', label: 'Match Inbox', icon: Inbox, live: true },
      { href: '/objections', label: 'Objections', icon: MessageSquareWarning, live: true },
      { href: '/cap-table', label: 'Cap Table', icon: PieChart, live: true },
      { href: '/governance', label: 'Governance', icon: Scale, live: true },
      { href: '/audit', label: 'Audit Trail', icon: History, live: true }
    ]
  }
];

/**
 * Map each lifecycle stage to the cluster(s) it primarily emphasizes. Drives
 * stage-aware auto-expand + the subtle gold emphasis on the cluster heading
 * when `signals.currentStage` is set. A hint, never a hard requirement.
 */
export const STAGE_TO_GROUP_KEYS: Record<LifecycleStage, readonly RailGroupKey[]> = {
  establish_truth: ['the-record'],
  get_raise_ready: ['the-record', 'the-workshop'],
  source_lps: ['the-network'],
  convert_lps: ['the-network'],
  source_deals: ['the-network'],
  operate: ['the-workshop'],
  prove: ['desk-tools']
};
