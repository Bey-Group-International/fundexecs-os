import type { MemberType } from '@/lib/member-types';

/**
 * "Live value preview" content for the invite-arrival surfaces — the concrete
 * first moves Earn lines up for each member type, shown the moment someone picks
 * who they are, so they see the payoff before they even finish signing in.
 *
 * Static + content-only (no fetch): cheap, instant, and safe on the pre-auth
 * claim page. Keep each list to three high-signal moves.
 */
export interface ValuePreview {
  /** One-line framing of what Earn will do for this member type. */
  headline: string;
  /** The three concrete first moves, phrased as Earn doing the work. */
  moves: string[];
}

export const FIRST_MOVES: Record<MemberType, ValuePreview> = {
  investment_firm: {
    headline: 'Your deal engine, lit up on day one',
    moves: [
      'Stand up your pipeline and score inbound against your thesis',
      'Draft diligence checklists + a data-room request list per deal',
      'Map warm paths to LPs and co-investors from your network'
    ]
  },
  individual_investor: {
    headline: 'A sharper edge on every opportunity',
    moves: [
      'Build a watchlist and triage what actually fits your mandate',
      'Pressure-test a thesis with a fast diligence brief',
      'Track allocations and surface follow-ons before they close'
    ]
  },
  startup: {
    headline: 'Raise-ready, faster',
    moves: [
      'Tighten your narrative + one-pager from your profile',
      'Build a targeted investor list and warm-intro paths',
      'Prep a clean data room and track outreach to close'
    ]
  },
  service_provider: {
    headline: 'Matched to the work that fits you',
    moves: [
      'Surface funds and founders who need exactly what you do',
      'Stand up a referral pipeline with warm-intro paths',
      'Turn your profile into proof that wins the engagement'
    ]
  },
  student: {
    headline: 'A front-row seat to how the pros operate',
    moves: [
      'Learn the deal lifecycle by working a live pipeline',
      'Build a credible, verified profile employers trust',
      'Shadow Earn’s diligence to sharpen your judgment'
    ]
  }
};
