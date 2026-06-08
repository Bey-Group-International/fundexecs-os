import type { MemberType } from '@/lib/member-types';

/**
 * Canonical "first moves" per member type — the single source of truth shared by
 * the invite-arrival value preview (`components/beta/ValuePreview`) and the
 * post-onboarding Earn launch brief (`lib/proof-of-truth/launch-brief` + its API
 * route + card). One list keeps the "what Earn lines up for you" copy consistent
 * from the moment they pick who they are through their first command-center load.
 */

/** One concrete first move on the desk — a label, a one-line reason, a destination. */
export interface FirstMove {
  /** Short, imperative label, e.g. "Add your first LP". */
  label: string;
  /** One line on why this is the move to make first. */
  detail: string;
  /** In-app destination this move opens (mirrors the onboarding FIRST_ACTION map). */
  href: string;
}

/** The first-moves package for a member type: a benefit headline + three moves. */
export interface MemberFirstMoves {
  /** One-line framing of what Earn will do for this member type. */
  headline: string;
  /** Three high-leverage first moves, in priority order. */
  moves: FirstMove[];
}

/**
 * Three first moves per member type, with a benefit headline. Used as the
 * templated fallback + structural floor for the AI launch brief, and as the
 * pre-auth arrival value preview. Concrete and member-type-true.
 */
export const FIRST_MOVES: Record<MemberType, MemberFirstMoves> = {
  investment_firm: {
    headline: 'Your deal engine, lit up on day one',
    moves: [
      {
        label: 'Add your first LP',
        detail:
          'Seed your pipeline with one real relationship so the desk has something to run on.',
        href: '/pipeline'
      },
      {
        label: 'Sharpen your thesis',
        detail: 'A precise thesis is what LPs and co-investors read first — make it unmistakable.',
        href: '/profile'
      },
      {
        label: 'Open your command center',
        detail: 'See the daily moves Earn has queued against your mandate.',
        href: '/command-center'
      }
    ]
  },
  individual_investor: {
    headline: 'A sharper edge on every opportunity',
    moves: [
      {
        label: 'Build your watchlist',
        detail: 'Track the deals you want to see, so Earn can surface the right ones early.',
        href: '/pipeline'
      },
      {
        label: 'State your value-add',
        detail: 'Beyond capital, what you bring is what wins allocation in competitive rounds.',
        href: '/profile'
      },
      {
        label: 'Open your command center',
        detail: 'Review the moves Earn has lined up for your allocator desk.',
        href: '/command-center'
      }
    ]
  },
  startup: {
    headline: 'Raise-ready, faster',
    moves: [
      {
        label: 'Prep your materials',
        detail: 'Get your deck and data room audit-ready before the first investor reply.',
        href: '/materials'
      },
      {
        label: 'Build your investor target list',
        detail: 'Line up the funds that fit your stage and sector so outreach is warm, not cold.',
        href: '/pipeline'
      },
      {
        label: 'Open your command center',
        detail: 'Earn sequences the round so every conversation moves it forward.',
        href: '/command-center'
      }
    ]
  },
  service_provider: {
    headline: 'Matched to the work that fits you',
    moves: [
      {
        label: 'See your matches',
        detail: 'Earn routes you to the counterparties actively looking for what you do.',
        href: '/partners'
      },
      {
        label: 'Define your ideal client',
        detail: 'Naming who you serve best earns warmer, better-qualified introductions.',
        href: '/profile'
      },
      {
        label: 'Open your command center',
        detail: 'Watch inbound, matches, and demand signal land on the record.',
        href: '/command-center'
      }
    ]
  },
  student: {
    headline: 'A front-row seat to how the pros operate',
    moves: [
      {
        label: 'Open your command center',
        detail: 'Start the loop — Earn runs the desk while you build the instincts.',
        href: '/command-center'
      },
      {
        label: 'Name your interests',
        detail: 'Your interests connect you to the right conversations and mentors.',
        href: '/profile'
      },
      {
        label: 'Set your career goal',
        detail: 'A clear goal tells firms and mentors exactly how to help you.',
        href: '/profile'
      }
    ]
  }
};
