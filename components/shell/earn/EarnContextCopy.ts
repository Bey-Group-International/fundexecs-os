import {
  Activity,
  AlertCircle,
  Award,
  Briefcase,
  ClipboardCheck,
  Compass,
  CreditCard,
  FileSearch,
  FilePlus,
  FileSignature,
  Handshake,
  History,
  Inbox,
  Layers,
  ListChecks,
  Mail,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon
} from 'lucide-react';
import type { EarnContextKind } from './EarnContext';

/* ----------------------------------------------------------------------------
 * EarnContextCopy — per-context voice + quick-actions for the Earn dock.
 *
 * Wave-1: presentational only. The actions are chips that pre-seed the
 * EarnChat input (the rest of the chat path is untouched). Voice line stays
 * "Chief Operating Officer · your live AI guide" everywhere; the context-
 * specific copy is the SUBTITLE under it — what Earn is "looking at right
 * now". Audit-ready language ("on the record", "documented as it forms").
 * --------------------------------------------------------------------------*/

export interface EarnContextAction {
  /** Label that renders as a quick-action chip. */
  label: string;
  /** Prompt seeded into EarnChat when tapped. */
  prompt: string;
  icon: LucideIcon;
}

export interface EarnContextCopy {
  /** What Earn is focused on right now — appears as the dock subtitle. */
  subtitle: string;
  /** Short glimpse of which specialists are currently spinning behind the scenes. */
  activity: string;
  /** Up to 5 quick-actions surfaced under the chat. */
  actions: EarnContextAction[];
}

export const CONTEXT_COPY: Record<EarnContextKind, EarnContextCopy> = {
  dashboard: {
    subtitle: "Today's command center · what to act on next",
    activity: 'Strategist + Concierge are pre-ranking the day.',
    actions: [
      {
        label: "Rank today's priorities",
        prompt: "Rank today's priorities for me.",
        icon: ListChecks
      },
      {
        label: 'Where am I in the lifecycle?',
        prompt: 'Where am I in the lifecycle and what unblocks the next stage?',
        icon: Compass
      },
      {
        label: 'Summarize last 24h',
        prompt: 'Summarize what changed in the last 24 hours.',
        icon: Activity
      },
      {
        label: 'One thing I should escalate',
        prompt: 'What is the one thing I should escalate today?',
        icon: AlertCircle
      },
      {
        label: 'Draft my daily standup',
        prompt: 'Draft my daily standup note for the team.',
        icon: ClipboardCheck
      }
    ]
  },
  'fund-profile': {
    subtitle: 'Source of Truth · documented as it forms',
    activity: 'Strategist + Storyteller are sharpening the LP-probe answers.',
    actions: [
      {
        label: 'Close my profile gaps',
        prompt: 'Walk me through closing the open gaps on my fund profile.',
        icon: Target
      },
      {
        label: 'Sharpen my thesis',
        prompt: 'Sharpen my investment thesis for an institutional LP audience.',
        icon: Sparkles
      },
      {
        label: 'Draft track-record blurb',
        prompt: 'Draft a track-record blurb from my prior deals.',
        icon: History
      },
      {
        label: 'LP-probe stress test',
        prompt: 'Stress-test my fund profile the way a probing LP would.',
        icon: FileSearch
      },
      {
        label: 'Update terms · audit-ready',
        prompt: 'Update my fund terms (fee, carry, structure) so they are audit-ready.',
        icon: ShieldCheck
      }
    ]
  },
  trust: {
    subtitle: 'Chain of Trust · every claim provable',
    activity: 'Validator is reading freshly-uploaded evidence.',
    actions: [
      {
        label: 'Validate latest evidence',
        prompt: 'Validate the latest evidence I uploaded.',
        icon: ShieldCheck
      },
      {
        label: 'Highlight any gaps',
        prompt: 'Highlight any open Chain-of-Trust gaps across my deals.',
        icon: AlertCircle
      },
      {
        label: 'Audit-ready summary',
        prompt: 'Give me an audit-ready summary of trust status across all active deals.',
        icon: ClipboardCheck
      }
    ]
  },
  pipeline: {
    subtitle: 'LP Pipeline · move warm conversations forward',
    activity: 'Concierge + Storyteller are queuing intros and follow-ups.',
    actions: [
      {
        label: 'Rank LPs by convertibility',
        prompt: 'Rank my LPs by convertibility and tell me who to call this week.',
        icon: TrendingUp
      },
      {
        label: 'Draft outreach to stalled LPs',
        prompt: 'Draft outreach to the LPs who have gone quiet for 14+ days.',
        icon: Mail
      },
      {
        label: 'Suggest a warm intro path',
        prompt: 'Suggest a warm-intro path for my top 3 cold LPs.',
        icon: Handshake
      },
      {
        label: 'Build a target list',
        prompt: 'Build a target LP list that matches my fund thesis.',
        icon: ListChecks
      }
    ]
  },
  lp: {
    subtitle: 'LP focus · move this relationship forward',
    activity: 'Concierge is brushing up the relationship snapshot.',
    actions: [
      {
        label: 'Draft next-touch email',
        prompt: 'Draft a next-touch email for this LP.',
        icon: Mail
      },
      {
        label: 'Snapshot the relationship',
        prompt: 'Snapshot the relationship history with this LP.',
        icon: History
      },
      {
        label: 'Forecast convertibility',
        prompt: "Forecast this LP's likelihood to commit and why.",
        icon: TrendingUp
      }
    ]
  },
  'deal-desk': {
    subtitle: 'Deal Desk · source, screen, decide',
    activity: 'Diligence + IC scribe are warming up.',
    actions: [
      {
        label: 'Screen this deal',
        prompt: 'Walk me through screening this deal against my mandate.',
        icon: FileSearch
      },
      {
        label: 'Draft an IC memo',
        prompt: 'Draft an IC memo for the deal I am evaluating.',
        icon: FileSignature
      },
      {
        label: 'Pull comparable deals',
        prompt: 'Pull comparable deals from my history.',
        icon: Briefcase
      }
    ]
  },
  deal: {
    subtitle: 'Deal in focus · diligence, conviction, capital',
    activity: "Diligence + IC scribe are reviewing this deal's file.",
    actions: [
      {
        label: 'Run diligence on this deal',
        prompt: 'Run diligence on this deal and surface red flags.',
        icon: FileSearch
      },
      { label: 'Draft IC memo', prompt: 'Draft an IC memo for this deal.', icon: FileSignature },
      {
        label: 'Pressure-test conviction',
        prompt: 'Pressure-test my conviction on this deal.',
        icon: Target
      },
      {
        label: 'Allocation scenarios',
        prompt: 'Model allocation scenarios for this deal.',
        icon: Layers
      },
      {
        label: 'What would kill this deal?',
        prompt: 'What would kill this deal? Be ruthless.',
        icon: AlertCircle
      }
    ]
  },
  'capital-stack': {
    subtitle: 'Capital Stack · raise pacing on the record',
    activity: 'Strategist is mapping commitments to the stack.',
    actions: [
      {
        label: 'Pace the raise',
        prompt: 'Pace my raise against target and tell me where the gaps are.',
        icon: TrendingUp
      },
      {
        label: 'Show concentration risk',
        prompt: 'Show LP concentration risk across the stack.',
        icon: AlertCircle
      },
      {
        label: 'Draft a close-document checklist',
        prompt: 'Draft a close-document checklist.',
        icon: ClipboardCheck
      }
    ]
  },
  objection: {
    subtitle: 'Objections · turn pushback into commitments',
    activity: 'Storyteller is sharpening the rebuttal library.',
    actions: [
      {
        label: 'Rebut this objection',
        prompt: 'Help me rebut this LP objection in a way that builds trust.',
        icon: MessagesSquare
      },
      {
        label: 'Find similar objections I won',
        prompt: 'Find similar objections I have already won and reuse the play.',
        icon: History
      }
    ]
  },
  intelligence: {
    subtitle: 'Intelligence · signal in, knowledge out',
    activity: 'Inbox specialist + librarian are filing what came in.',
    actions: [
      {
        label: "Brief me on this week's signal",
        prompt: "Brief me on this week's inbox + market signal.",
        icon: Inbox
      },
      {
        label: 'Surface relevant knowledge',
        prompt: 'Surface knowledge I should reuse for what I am working on.',
        icon: Compass
      },
      {
        label: 'Flag anything urgent',
        prompt: 'Flag anything urgent in my inbox intelligence.',
        icon: AlertCircle
      }
    ]
  },
  materials: {
    subtitle: 'Capital Materials · LP-ready, audit-ready',
    activity: 'Storyteller is dressing assets in the right voice.',
    actions: [
      {
        label: 'Draft deck talking points',
        prompt: 'Draft deck talking points for my next LP meeting.',
        icon: FilePlus
      },
      {
        label: 'Tailor materials for this LP',
        prompt: 'Tailor my LP materials for a specific institutional LP.',
        icon: Sparkles
      },
      {
        label: 'Quality-check my deck',
        prompt: 'Quality-check my deck like an institutional LP would.',
        icon: FileSearch
      }
    ]
  },
  partners: {
    subtitle: 'Partner Marketplace · borrow trusted hands',
    activity: 'Concierge is matching needs to verified partners.',
    actions: [
      {
        label: 'Recommend a partner',
        prompt: 'Recommend a partner for what I am working on right now.',
        icon: Handshake
      },
      {
        label: 'Draft a scope-of-work',
        prompt: 'Draft a scope-of-work for a partner engagement.',
        icon: ClipboardCheck
      }
    ]
  },
  audit: {
    subtitle: 'Audit · every decision provable + reusable',
    activity: 'Memory keeper is filing decisions into the trail.',
    actions: [
      {
        label: 'Replay last big decision',
        prompt: 'Replay my last big decision and what informed it.',
        icon: History
      },
      {
        label: 'Audit-ready export',
        prompt: 'Compile an audit-ready export for the last 90 days.',
        icon: ClipboardCheck
      }
    ]
  },
  settings: {
    subtitle: 'Profile & settings · how Earn speaks for you',
    activity: 'Configuring is private — no specialists running.',
    actions: [
      {
        label: 'What does each setting unlock?',
        prompt: 'Explain what each setting category unlocks across the app.',
        icon: Sparkles
      },
      {
        label: 'Help me complete my profile',
        prompt: 'Help me complete the parts of my profile that boost LP trust the most.',
        icon: Award
      }
    ]
  },
  'action-queue': {
    subtitle: 'Action Queue · the next 30 minutes',
    activity: 'Strategist is ordering the queue by impact.',
    actions: [
      {
        label: "What's next in 30 min?",
        prompt: 'What should I do in the next 30 minutes?',
        icon: Zap
      },
      {
        label: 'Batch similar actions',
        prompt: 'Batch similar actions so I can clear them in one pass.',
        icon: ListChecks
      },
      {
        label: 'Defer what can wait',
        prompt: 'Tell me what I can safely defer until tomorrow.',
        icon: History
      }
    ]
  },
  'match-inbox': {
    subtitle: 'Match Inbox · who matched, who to answer',
    activity: 'Concierge is reading match signals.',
    actions: [
      {
        label: "Rank today's matches",
        prompt: "Rank today's matches by relevance to my mandate.",
        icon: TrendingUp
      },
      { label: 'Draft a warm reply', prompt: 'Draft a warm reply to my top match.', icon: Mail }
    ]
  },
  onboarding: {
    subtitle: 'Profile setup · build your record together',
    activity: 'Strategist + Storyteller are co-authoring with you.',
    actions: [
      {
        label: 'Tighten my last answer',
        prompt: 'Tighten the last answer I wrote.',
        icon: Sparkles
      },
      {
        label: 'What does this question unlock?',
        prompt: 'Explain why this question matters for LPs.',
        icon: Award
      },
      {
        label: "Skip what doesn't fit me",
        prompt: 'Tell me which questions I can skip given my member type.',
        icon: ListChecks
      }
    ]
  },
  generic: {
    subtitle: 'Your live AI guide · the team behind every action',
    activity: 'The whole team is listening — ask anything.',
    actions: [
      { label: 'What should I do next?', prompt: 'What should I do next?', icon: Zap },
      {
        label: 'Brief me on my fund',
        prompt: 'Brief me on the current state of my fund.',
        icon: ClipboardCheck
      },
      {
        label: 'Pull a comp / play',
        prompt: 'Pull a comparable play from my history.',
        icon: History
      }
    ]
  }
};

/** Get the copy for a context kind — guarantees a fallback. */
export function copyFor(kind: EarnContextKind): EarnContextCopy {
  return CONTEXT_COPY[kind] ?? CONTEXT_COPY.generic;
}

/** Default-export icon used elsewhere if a consumer wants the wallet glyph. */
export { CreditCard as WalletIcon, Users as TeamIcon };
