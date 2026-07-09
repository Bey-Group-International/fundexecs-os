// Shared reputation-tier copy for the wallet standing summary and the rewards
// sub-page. Kept in one place so the wallet's slim summary and the full rewards
// detail can never describe the same tier differently.
import type { ReputationTier } from "@/lib/compounding";

export const TIER_META: Record<ReputationTier, { label: string; blurb: string }> = {
  unranked: {
    label: "New Member",
    blurb: "Complete verified transactions to build your standing — it reduces the cost of every AI action.",
  },
  verified: {
    label: "Verified Operator",
    blurb: "A proven track record. Your actions cost less and your listings surface higher.",
  },
  established: {
    label: "Established",
    blurb: "Priority queue, deeper discounts, and the ability to attest verified outcomes.",
  },
  principal: {
    label: "Principal",
    blurb: "Top standing — maximum discount, lowest stake, and the standing to vouch for others.",
  },
};
