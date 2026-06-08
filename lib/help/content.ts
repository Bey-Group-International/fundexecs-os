import {
  Rocket,
  LayoutGrid,
  Compass,
  Sparkles,
  Users,
  ListChecks,
  ShieldCheck,
  Coins,
  Plug,
  Search,
  Map,
  type LucideIcon
} from 'lucide-react';

/* ============================================================================
 * lib/help/content.ts — the content model for the in-app Help launcher: how-to
 * guides, guided tours (coach-marks over the real UI), the getting-started
 * checklist, and quick links. Pure data so it's shared by the launcher and
 * search. Tour steps target stable `data-testid` selectors on the shell.
 * ========================================================================= */

// ── How-to guides ────────────────────────────────────────────────────────────

export type HelpBlock =
  | { type: 'p'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'tip'; text: string };

export interface HelpGuide {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  /** Extra search terms beyond the title/summary. */
  keywords: string;
  body: HelpBlock[];
}

export const GUIDES: HelpGuide[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Set up your desk and put the team to work in minutes.',
    icon: Rocket,
    keywords: 'onboarding first run setup begin start proof of truth mandate',
    body: [
      {
        type: 'p',
        text: 'FundExecs OS is your operating desk — Earn and fourteen specialists working your mandate end to end. Here is the fastest path to value.'
      },
      {
        type: 'steps',
        items: [
          'Complete your Proof of Truth so Earn understands your thesis, targets, and constraints.',
          'Connect your tools (Gmail, Calendar, Drive, Slack) from Integrations so the desk has real signal.',
          'Open the Earn dock and ask for your next best action.',
          'Explore the Command Center — your home surface for everything in motion.'
        ]
      },
      {
        type: 'tip',
        text: 'In a hurry? Run the 60-second tour from the Help menu to see where everything lives.'
      }
    ]
  },
  {
    id: 'the-desk',
    title: 'The desk & side rail',
    summary: 'How work is organized across six logic areas.',
    icon: LayoutGrid,
    keywords:
      'navigation side rail menu areas source of truth capital formation diligence decisions relationships operations',
    body: [
      {
        type: 'p',
        text: 'The side rail organizes the desk into six areas that follow the capital lifecycle: Source of Truth, Capital Formation, Diligence, Decisions, Relationships, and Operations.'
      },
      {
        type: 'p',
        text: 'The rail auto-expands the area that matches your current stage, so the next move is always one click away. Your fund profile summary sits at the top of Source of Truth.'
      },
      {
        type: 'tip',
        text: 'Press ⌘K (Ctrl-K) anywhere to jump to a deal, LP, or action without leaving your hands on the keyboard.'
      }
    ]
  },
  {
    id: 'command-center',
    title: 'The Command Center',
    summary: 'Your home surface — everything in motion, at a glance.',
    icon: Compass,
    keywords: 'dashboard home command center overview today',
    body: [
      {
        type: 'p',
        text: 'The Command Center is where you land. It surfaces what needs you now — live deals, capital in motion, and the actions Earn recommends next.'
      },
      {
        type: 'p',
        text: 'From here you can drill into any specialized screen: Pipeline, Diligence, IC Memos, LP Room, and the Capital Stack.'
      }
    ]
  },
  {
    id: 'working-with-earn',
    title: 'Working with Earn',
    summary: 'Ask in plain English; Earn returns done work, not a to-do list.',
    icon: Sparkles,
    keywords: 'earn ai chat assistant ask coo concierge dock orb',
    body: [
      {
        type: 'p',
        text: 'Earn is your Chief Operating Officer — the operator-facing concierge that orchestrates the whole desk. Open the gold Earn orb (bottom-right) any time to chat.'
      },
      {
        type: 'p',
        text: 'Earn knows what screen you are on, so you can say things like "draft the counter on this deal" or "who should I follow up with this week" and get an answer in context.'
      },
      {
        type: 'tip',
        text: 'You approve; the team executes. Every action Earn takes is recorded on the Chain of Trust.'
      }
    ]
  },
  {
    id: 'the-team',
    title: 'The 15 specialists',
    summary: 'Who does what across sourcing, diligence, and closing.',
    icon: Users,
    keywords:
      'team agents specialists rainmaker deal sourcer capital connector legal investor relations',
    body: [
      {
        type: 'p',
        text: 'Earn leads fourteen specialists — Rainmaker (the closer), Deal Sourcer, Capital Connector, Legal/Admin, Investor Relations, and more. Each carries your mandate.'
      },
      {
        type: 'p',
        text: 'You rarely pick an agent by hand: the Master Workflow routes each request to the right specialist automatically.'
      }
    ]
  },
  {
    id: 'chain-of-trust',
    title: 'The Chain of Trust',
    summary: 'Why every result is auditable, not opaque.',
    icon: ShieldCheck,
    keywords: 'trust audit proof identity source execution outcome verifiable evidence',
    body: [
      {
        type: 'p',
        text: 'Every material action carries a verifiable trail across four layers — Identity (who acted), Source (what it is grounded in), Execution (what was done), and Outcome (what resulted).'
      },
      {
        type: 'p',
        text: 'That means you can walk into any IC or LP meeting with the receipts already in hand. Open the Trust center to see the chain for any record.'
      }
    ]
  },
  {
    id: 'credits',
    title: 'Credits & the wallet',
    summary: 'How agent runs are powered and topped up.',
    icon: Coins,
    keywords: 'credits wallet billing earn coins top up balance fuel gauge plan',
    body: [
      {
        type: 'p',
        text: 'Agent runs draw from your organization’s Credit Wallet. The fuel gauge in the top bar shows your balance at a glance.'
      },
      {
        type: 'steps',
        items: [
          'Top up instantly from the wallet gauge in the top bar.',
          'Manage your plan and recurring credits in Settings → Plan & credits.',
          'Balances are scoped per organization.'
        ]
      }
    ]
  },
  {
    id: 'integrations',
    title: 'Connect your tools',
    summary: 'Bring Gmail, Calendar, Drive, Slack, and more into the desk.',
    icon: Plug,
    keywords: 'integrations connect gmail calendar drive slack zoom crm sync tools',
    body: [
      {
        type: 'p',
        text: 'Integrations give the desk real signal — relationships, meetings, and files flow in automatically. Open Settings → Integrations (or the standalone Integrations page).'
      },
      {
        type: 'steps',
        items: [
          'Pick a provider and click Connect to authorize it.',
          'Use “Sync now” any time to pull the latest.',
          'Manage, reconnect, or disconnect a provider from its card.'
        ]
      }
    ]
  }
];

// ── Guided tours (coach-marks over the real UI) ──────────────────────────────

export interface TourStep {
  /** CSS selector for the element to spotlight (stable shell `data-testid`s). */
  target: string;
  title: string;
  body: string;
  /** Preferred tooltip side; falls back automatically when it won't fit. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface HelpTour {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  steps: TourStep[];
}

export const TOURS: HelpTour[] = [
  {
    id: 'essentials',
    title: 'The 60-second tour',
    description: 'The five things worth knowing on day one.',
    icon: Map,
    steps: [
      {
        target: '[data-testid="side-rail-nav"]',
        title: 'Your desk, organized',
        body: 'The side rail follows the capital lifecycle across six areas. It auto-expands the one that matches your current stage.',
        placement: 'right'
      },
      {
        target: '[data-testid="topnav-search-input"]',
        title: 'Jump anywhere — ⌘K',
        body: 'Search or press ⌘K (Ctrl-K) to leap to any deal, LP, or action instantly.',
        placement: 'bottom'
      },
      {
        target: '[data-testid="credit-wallet-gauge"]',
        title: 'Your Credit Wallet',
        body: 'Agent runs draw from here. Watch your balance and top up in one click.',
        placement: 'bottom'
      },
      {
        target: '[data-testid="topnav-notifications-bell"]',
        title: 'Stay in the loop',
        body: 'The bell collects what the desk did and what needs you — without leaving the page.',
        placement: 'bottom'
      },
      {
        target: '[data-testid="earn-orb"]',
        title: 'Meet Earn',
        body: 'Your AI COO. Open this any time and ask, in plain English, for your next best move.',
        placement: 'left'
      }
    ]
  },
  {
    id: 'meet-earn',
    title: 'Get the most from Earn',
    description: 'How to put your AI executive team to work.',
    icon: Sparkles,
    steps: [
      {
        target: '[data-testid="earn-orb"]',
        title: 'This is Earn',
        body: 'Click the gold orb to open the dock. Earn knows what screen you are on, so help is always in context.',
        placement: 'left'
      },
      {
        target: '[data-testid="side-rail-nav"]',
        title: 'Ask for outcomes',
        body: 'Say “draft the counter,” “who should I follow up with,” or “summarize this deal.” You approve; the team executes.',
        placement: 'right'
      }
    ]
  },
  {
    id: 'where-work-lives',
    title: 'Where your work lives',
    description: 'A quick map of the workspace.',
    icon: Compass,
    steps: [
      {
        target: '[data-testid="wave1-side-rail"]',
        title: 'Six logic areas',
        body: 'Source of Truth, Capital Formation, Diligence, Decisions, Relationships, and Operations — the full lifecycle, top to bottom.',
        placement: 'right'
      },
      {
        target: '[data-testid="side-rail-user-footer"]',
        title: 'Account & workspaces',
        body: 'Switch workspaces, change your role view, reach Settings, or sign out from here.',
        placement: 'right'
      }
    ]
  }
];

// ── Getting-started checklist ────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  /** Either a route to open, a tour to launch, or the Earn dock. */
  action: { kind: 'link'; href: string } | { kind: 'tour'; tourId: string } | { kind: 'earn' };
  cta: string;
  icon: LucideIcon;
}

export const CHECKLIST: ChecklistItem[] = [
  {
    id: 'tour',
    label: 'Take the 60-second tour',
    description: 'See where everything lives.',
    action: { kind: 'tour', tourId: 'essentials' },
    cta: 'Start tour',
    icon: Map
  },
  {
    id: 'proof-of-truth',
    label: 'Complete your Proof of Truth',
    description: 'Teach Earn your thesis and targets.',
    action: { kind: 'link', href: '/onboarding' },
    cta: 'Open',
    icon: ListChecks
  },
  {
    id: 'connect-tools',
    label: 'Connect your tools',
    description: 'Gmail, Calendar, Drive, Slack and more.',
    action: { kind: 'link', href: '/integrations' },
    cta: 'Connect',
    icon: Plug
  },
  {
    id: 'meet-earn',
    label: 'Meet Earn',
    description: 'Ask for your next best action.',
    action: { kind: 'earn' },
    cta: 'Open Earn',
    icon: Sparkles
  },
  {
    id: 'command-center',
    label: 'Explore your Command Center',
    description: 'Your home for everything in motion.',
    action: { kind: 'link', href: '/command-center' },
    cta: 'Open',
    icon: Compass
  },
  {
    id: 'invite-team',
    label: 'Invite your team',
    description: 'Bring colleagues into the workspace.',
    action: { kind: 'link', href: '/settings' },
    cta: 'Invite',
    icon: Users
  }
];

// ── Quick links ──────────────────────────────────────────────────────────────

export interface QuickLink {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

export const QUICK_LINKS: QuickLink[] = [
  {
    label: 'Documentation',
    description: 'The desk, Chain of Trust, and the agents.',
    href: '/docs',
    icon: LayoutGrid
  },
  {
    label: 'Trust center',
    description: 'How your work is verified.',
    href: '/trust',
    icon: ShieldCheck
  },
  {
    label: 'All help & FAQs',
    description: 'Contact support and common answers.',
    href: '/help',
    icon: Search
  }
];
