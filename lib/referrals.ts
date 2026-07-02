// Gift Earn reward economics — the multi-level "downline" referral program.
// All amounts are credits. Tuning lives here, mirroring lib/billing.ts, and the
// functions are pure so they can be reasoned about (and tested) in isolation.
//
// The program is designed to COMPOUND:
//   1. Each direct referral is worth MORE than the last (escalating tiers).
//   2. You keep earning when your referrals refer others — overrides that decay
//      by depth, up to MAX_LEVEL deep (the "downline").
//   3. One-time milestone bonuses reward sustained referring.

// Welcome bonus credited to a newly-referred org when it redeems a code.
export const REFERRAL_WELCOME_BONUS = 200;

// Direct (level-1) reward escalates with the referrer's lifetime direct-referral
// count, so the Nth referral can pay more than the (N-1)th.
export interface DirectTier {
  /** Applies to direct referrals numbered up to and including this count. */
  upTo: number;
  reward: number;
}
export const DIRECT_TIERS: DirectTier[] = [
  { upTo: 2, reward: 250 },
  { upTo: 5, reward: 400 },
  { upTo: 9, reward: 600 },
  { upTo: Number.POSITIVE_INFINITY, reward: 900 },
];

/** Credits the referrer earns for their `nth` direct referral (1-indexed). */
export function directReward(nth: number): number {
  for (const t of DIRECT_TIERS) if (nth <= t.upTo) return t.reward;
  return DIRECT_TIERS[DIRECT_TIERS.length - 1].reward;
}

// Indirect overrides — you also earn when someone in your downline refers a new
// org, decaying by depth. Level 1 is the direct referrer (handled by tiers
// above); levels 2..MAX_LEVEL earn these fixed overrides.
export const LEVEL_OVERRIDES: Record<number, number> = { 2: 100, 3: 50 };
export const MAX_LEVEL = 3;

/** Override credits earned by an ancestor `level` hops up the chain. */
export function levelOverride(level: number): number {
  return LEVEL_OVERRIDES[level] ?? 0;
}

// One-time milestone bonuses, awarded the moment cumulative direct referrals
// reaches `count`. Each carries a rank shown on the Gift Earn dashboard.
export interface Milestone {
  count: number;
  bonus: number;
  rank: string;
}
export const MILESTONES: Milestone[] = [
  { count: 3, bonus: 500, rank: "Connector" },
  { count: 5, bonus: 1_000, rank: "Rainmaker" },
  { count: 10, bonus: 3_000, rank: "Kingmaker" },
  { count: 25, bonus: 10_000, rank: "Legend" },
];

/** The milestone exactly reached at this direct-referral count, if any. */
export function milestoneAt(count: number): Milestone | null {
  return MILESTONES.find((m) => m.count === count) ?? null;
}

/** Current rank (highest milestone reached) and progress to the next one. */
export function rankFor(directCount: number): {
  rank: string;
  next: Milestone | null;
  /** 0..1 progress toward `next` (1 when there is no next milestone). */
  progress: number;
} {
  let rank = "Scout";
  let reachedCount = 0;
  for (const m of MILESTONES) {
    if (directCount >= m.count) {
      rank = m.rank;
      reachedCount = m.count;
    }
  }
  const next = MILESTONES.find((m) => m.count > directCount) ?? null;
  const progress = next
    ? (directCount - reachedCount) / (next.count - reachedCount)
    : 1;
  return { rank, next, progress };
}

// Reasons recorded in the credit ledger, so earnings can be grouped and shown.
export const REFERRAL_REASONS = [
  "referral_direct",
  "referral_override",
  "referral_milestone",
  "referral_welcome",
] as const;
export type LedgerReason =
  | (typeof REFERRAL_REASONS)[number]
  | "gift_received"
  | "gift_sent"
  | "plan_grant"
  | "pack_purchase"
  | "stake_lock"
  | "stake_release"
  | "spend"
  | "loyalty"
  // Execution-driven gamification rewards
  | "task_complete"
  | "streak_bonus"
  | "milestone_bonus"
  | "hub_achievement"
  | "quest_complete";

/** Whether a ledger reason represents referral earnings (for totals). */
export function isReferralEarning(reason: string): boolean {
  return (REFERRAL_REASONS as readonly string[]).includes(reason);
}
