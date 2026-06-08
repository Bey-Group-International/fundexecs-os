import type { MemberType } from '@/lib/member-types';

/**
 * One concrete first move on the desk — a label the member can act on and the
 * surface it opens. Hrefs mirror the onboarding FIRST_ACTION map so the brief
 * lands the member exactly where the relevant work happens.
 */
export interface FirstMove {
  /** Short, imperative label, e.g. "Add your first LP". */
  label: string;
  /** One line on why this is the move to make first. */
  detail: string;
  /** In-app destination this move opens. */
  href: string;
}

/**
 * Three high-leverage first moves per member type. Used both as the templated
 * fallback for the launch brief (when Earn is unavailable) and as the structural
 * floor the AI brief is built on. Kept concrete and member-type-true.
 */
export const FIRST_MOVES: Record<MemberType, FirstMove[]> = {
  investment_firm: [
    {
      label: 'Add your first LP',
      detail: 'Seed your pipeline with one real relationship so the desk has something to run on.',
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
  ],
  individual_investor: [
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
  ],
  startup: [
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
  ],
  service_provider: [
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
  ],
  student: [
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
};
