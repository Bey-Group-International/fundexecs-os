import type { ReputationTier } from "@/lib/compounding";

// A compact, presentational pill for an org's reputation tier (see
// docs/TOKENIZATION_LAYERS.md §4). Pure/stateless — no data fetching. Styled in
// the neural theme so the marketplace surfaces read consistently with the Wallet
// "Standing" card. Prominence climbs with tier: unranked is muted; principal is
// the brightest.

const TIER_LABEL: Record<ReputationTier, string> = {
  unranked: "New Member",
  verified: "Verified",
  established: "Established",
  principal: "Principal",
};

// Increasingly prominent neural styling as standing rises.
const TIER_STYLE: Record<ReputationTier, string> = {
  unranked: "border-line text-fg-muted",
  verified: "border-neural-400/30 bg-neural-400/[0.06] text-neural-300",
  established: "border-neural-400/45 bg-neural-400/10 text-neural-300",
  principal:
    "border-neural-400/60 bg-neural-400/15 text-neural-200 shadow-[0_0_12px_rgba(118,185,0,0.25)]",
};

/** The display label for a reputation tier. Exported for reuse by callers. */
export function tierLabel(tier: ReputationTier): string {
  return TIER_LABEL[tier];
}

export function TierBadge({ tier }: { tier: ReputationTier }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
