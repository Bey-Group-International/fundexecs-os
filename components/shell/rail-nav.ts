import {
  // Pinned
  LayoutDashboard,
  // Build
  Hammer,
  IdCard,
  Compass,
  Gauge,
  ShieldCheck,
  Building2,
  // Source
  Radar,
  Briefcase,
  TrendingUp,
  Layers,
  // Run
  Play,
  FileSearch,
  Activity,
  Scale,
  Workflow,
  // Drive
  Rocket,
  Palette,
  ClipboardCheck,
  PieChart,
  Target,
  // Shared
  Sparkles,
  type LucideIcon
} from 'lucide-react';
import type { LifecycleStage } from '@/lib/lifecycle';
import { RUN_EARN_PROMPTS } from '@/lib/run/workspace';

/* ----------------------------------------------------------------------------
 * Rail navigation registry — the single source of truth for the side rail.
 *
 * The rail is the operating LOOP, not a menu: Build → Source → Run → Drive.
 * Each verb is a stage you move through; each carries one Earn action launcher
 * (the verb, made one-tap). Existing surfaces are folded in only where they
 * drive that stage — no buttons for the sake of buttons. Net-new AI concepts
 * (Stress Test, Aggregation Strategy, Formation, Execute) are click-to-Earn
 * actions — no dead "soon" rows remain in the registry, though the renderer
 * still supports them (and expandable `children`) for future surfaces.
 *
 * Scope guardrail: UI metadata only. Must not import from `lib/queries/*`,
 * `lib/supabase/*`, or any loader.
 * --------------------------------------------------------------------------*/

/** Stable cluster keys — used for stage emphasis + persisted collapse. */
export type RailGroupKey = 'build' | 'source' | 'run' | 'drive';

/** A nested third-tier row (e.g. Execute → Pre-Acquisition/Post-Acquisition/Exit). */
export interface RailSubItem {
  /** Route to navigate to. Omit for an unbuilt "soon" sub-row. */
  href?: string;
  label: string;
  live?: boolean;
  hint?: string;
}

/**
 * One rail entry. Exactly one of `href` (a route), `earnPrompt` (opens the Earn
 * dock), or `children` (an expandable sub-group) defines its behavior. With
 * none of those and `live: false`, it renders as a muted "soon" row.
 */
export interface RailNavItem {
  label: string;
  icon: LucideIcon;
  /** Route to navigate to. */
  href?: string;
  /** Clicking opens the Earn dock seeded with this prompt (AI action). */
  earnPrompt?: string;
  /** Expandable third tier. */
  children?: RailSubItem[];
  /** False (or absent + no href) renders a "soon" affordance. */
  live?: boolean;
  /** One-line value hint (title attr). */
  hint?: string;
}

/** An Earn-powered action launcher pinned atop a cluster. */
export interface RailLauncher {
  label: string;
  icon: LucideIcon;
  /** Prompt seeded into the Earn dock when triggered. */
  prompt: string;
}

/** One verb-cluster of the loop. */
export interface RailNavGroup {
  key: RailGroupKey;
  label: string;
  icon: LucideIcon;
  description?: string;
  launcher?: RailLauncher;
  items: RailNavItem[];
}

/** Command Center — pinned above the loop. The live operating picture. */
export const RAIL_PINNED: RailNavItem = {
  href: '/command-center',
  label: 'Command Center',
  icon: LayoutDashboard,
  live: true,
  hint: 'Your live operating picture'
};

/**
 * The loop. Items reuse existing routes where one drives the stage; net-new AI
 * concepts are click-to-Earn; unbuilt surfaces are "soon".
 */
export const RAIL_GROUPS: readonly RailNavGroup[] = [
  {
    key: 'build',
    label: 'Build',
    icon: Hammer,
    description: 'Build the record counterparties read from.',
    launcher: {
      label: 'Build my record',
      icon: Sparkles,
      prompt:
        'Help me build my record — tighten the profile, sharpen the approach (structure, story, narrative), and close the readiness gaps. What moves the needle most?'
    },
    items: [
      {
        href: '/build',
        label: 'Build Hub',
        icon: Hammer,
        live: true,
        hint: 'The verb on one surface — record strength, focus, next move'
      },
      {
        href: '/profile',
        label: 'Profile',
        icon: IdCard,
        live: true,
        hint: 'Your canonical record'
      },
      {
        href: '/strategy',
        label: 'Strategy',
        icon: Compass,
        live: true,
        hint: 'Structure · story · narrative'
      },
      {
        href: '/readiness',
        label: 'Readiness',
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
      },
      {
        href: '/formation',
        label: 'Formation',
        icon: Building2,
        live: true,
        hint: 'Entity & fund formation — copiloted'
      }
    ]
  },
  {
    key: 'source',
    label: 'Source',
    icon: Radar,
    description: 'Source the deals and capital that fit.',
    launcher: {
      label: 'Source deals & capital',
      icon: Sparkles,
      prompt:
        'Source new deals and capital that fit my thesis, and match them against my record. Show the strongest fits and why.'
    },
    items: [
      {
        href: '/source',
        label: 'Source Hub',
        icon: Radar,
        live: true,
        hint: 'The verb on one surface — capital in motion, focus, next move'
      },
      {
        href: '/deal-desk?view=sourcing',
        label: 'Deal Flow',
        icon: Briefcase,
        live: true,
        hint: 'Screen incoming deal flow'
      },
      {
        href: '/pipeline',
        label: 'LPs',
        icon: TrendingUp,
        live: true,
        hint: 'LP universe + pipeline'
      },
      {
        href: '/capital-stack',
        label: 'Capital',
        icon: Layers,
        live: true,
        hint: 'Search & shape the raise — equity, debt, hybrid in one place'
      }
    ]
  },
  {
    key: 'run',
    label: 'Run',
    icon: Play,
    description: 'Run the analysis that decides.',
    launcher: {
      label: 'Run diligence & stress tests',
      icon: Sparkles,
      prompt:
        'Run diligence and a stress test on my active deals — pressure-test the thesis, surface the risks, and draft an action plan.'
    },
    items: [
      {
        href: '/run',
        label: 'Run Hub',
        icon: Play,
        live: true,
        hint: 'The verb on one surface — capital awaiting a decision, next move'
      },
      {
        href: '/ic-memos',
        label: 'Diligence',
        icon: FileSearch,
        live: true,
        hint: 'Memos & decisions'
      },
      {
        label: 'Stress Test',
        icon: Activity,
        earnPrompt: RUN_EARN_PROMPTS.stressTest,
        hint: 'Scenario & downside analysis (Earn)'
      },
      {
        href: '/governance',
        label: 'Action Plan',
        icon: Scale,
        live: true,
        hint: 'Governance logic & next moves'
      },
      {
        label: 'Aggregation Strategy',
        icon: Workflow,
        earnPrompt: RUN_EARN_PROMPTS.aggregation,
        hint: 'Synergistic roll-up logic (Earn)'
      }
    ]
  },
  {
    key: 'drive',
    label: 'Drive',
    icon: Rocket,
    description: 'Drive the deal to close.',
    launcher: {
      label: 'Drive to close',
      icon: Sparkles,
      prompt:
        'Help me drive to close — what materials, signatures, and steps stand between here and a closed deal?'
    },
    items: [
      {
        href: '/drive',
        label: 'Drive Hub',
        icon: Rocket,
        live: true,
        hint: 'The verb on one surface — close progress, focus, next move'
      },
      {
        href: '/materials',
        label: 'Materials Studio',
        icon: Palette,
        live: true,
        hint: 'Decks, memos, one-pagers'
      },
      {
        href: '/deal-desk',
        label: 'Deal Desk',
        icon: ClipboardCheck,
        live: true,
        hint: 'Work the live deal'
      },
      {
        href: '/cap-table',
        label: 'Cap Table',
        icon: PieChart,
        live: true,
        hint: 'Ownership & dilution'
      },
      {
        label: 'Execute',
        icon: Target,
        earnPrompt:
          'Walk me through executing this deal across its lifecycle — pre-acquisition (close steps, signatures, conditions), post-acquisition (integration, 100-day plan, governance), and exit (timing, paths, value drivers). What should I line up at each stage?',
        hint: 'Pre-acquisition → exit (Earn)'
      }
    ]
  }
];

/**
 * Map each lifecycle stage to the loop verb(s) it primarily emphasizes. Drives
 * stage-aware auto-expand + the subtle gold emphasis on the cluster heading.
 */
export const STAGE_TO_GROUP_KEYS: Record<LifecycleStage, readonly RailGroupKey[]> = {
  establish_truth: ['build'],
  get_raise_ready: ['build'],
  source_lps: ['source'],
  convert_lps: ['source'],
  // "Source & execute deals" spans sourcing (Deals) and diligence/decide (Run).
  source_deals: ['source', 'run'],
  operate: ['run'],
  // "Prove & compound" — record proof in Chain of Trust (Build) and close out
  // via Execute/Exit (Drive); the loop feeds back into Build.
  prove: ['build', 'drive']
};
