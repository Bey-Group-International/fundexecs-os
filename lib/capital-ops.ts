// Agent-run capital operations — the engine behind a capital-call or
// distribution RUN. Carta makes an operator compute and book these by hand;
// here the Fund Admin agent plans the per-LP allocation pro-rata by commitment,
// the operator confirms (capital movement is Tier 3 — always operator sign-off),
// and it's booked to the ledger. Pure & dependency-free so the allocation is
// unit-testable and identical in preview and at commit.

export interface CommitmentLike {
  id: string;
  investor_id: string;
  committed_amount: number;
  called_amount: number;
  distributed_amount: number;
}

export type RunKind = "capital_call" | "distribution";

export interface RunAllocation {
  commitmentId: string;
  investorId: string;
  committed: number;
  /** Remaining callable (committed − called); only meaningful for calls. */
  unfunded: number;
  allocation: number;
}

export interface CapitalRunPlan {
  kind: RunKind;
  amount: number; // requested total
  totalAllocated: number; // sum actually allocated
  shortfall: number; // amount − totalAllocated (calls capped at unfunded)
  allocations: RunAllocation[];
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const whole = (v: number): number => Math.max(0, Math.round(v));

/**
 * Plan a capital call across a fund's commitments, pro-rata by committed
 * capital and capped at each LP's unfunded balance (you can't call more than is
 * committed). Any amount that can't be allocated surfaces as `shortfall`.
 */
export function planCapitalCall(commitments: CommitmentLike[], amount: number): CapitalRunPlan {
  const totalCommitted = commitments.reduce((s, c) => s + n(c.committed_amount), 0);
  const req = whole(amount);
  const allocations: RunAllocation[] = commitments.map((c) => {
    const committed = n(c.committed_amount);
    const unfunded = Math.max(0, committed - n(c.called_amount));
    const raw = totalCommitted > 0 ? (committed / totalCommitted) * req : 0;
    return {
      commitmentId: c.id,
      investorId: c.investor_id,
      committed,
      unfunded,
      allocation: Math.min(whole(raw), unfunded),
    };
  });
  const totalAllocated = allocations.reduce((s, a) => s + a.allocation, 0);
  return { kind: "capital_call", amount: req, totalAllocated, shortfall: Math.max(0, req - totalAllocated), allocations };
}

/**
 * Plan a distribution across a fund's commitments, pro-rata by committed
 * capital (ownership share). No cap — the full amount is allocated.
 */
export function planDistribution(commitments: CommitmentLike[], amount: number): CapitalRunPlan {
  const totalCommitted = commitments.reduce((s, c) => s + n(c.committed_amount), 0);
  const req = whole(amount);
  const allocations: RunAllocation[] = commitments.map((c) => {
    const committed = n(c.committed_amount);
    const raw = totalCommitted > 0 ? (committed / totalCommitted) * req : 0;
    return {
      commitmentId: c.id,
      investorId: c.investor_id,
      committed,
      unfunded: Math.max(0, committed - n(c.called_amount)),
      allocation: whole(raw),
    };
  });
  const totalAllocated = allocations.reduce((s, a) => s + a.allocation, 0);
  return { kind: "distribution", amount: req, totalAllocated, shortfall: Math.max(0, req - totalAllocated), allocations };
}

export function planRun(kind: RunKind, commitments: CommitmentLike[], amount: number): CapitalRunPlan {
  return kind === "capital_call" ? planCapitalCall(commitments, amount) : planDistribution(commitments, amount);
}
