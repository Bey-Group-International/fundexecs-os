// lib/commitment-tracker.ts
// Commitment-to-Close Tracker — manages the LP commitment lifecycle from
// soft-circle through close, using the existing `commitments` table as the
// ledger. Produces the structured intelligence the Earn copilot and capital-
// map UI consume.
//
// Lifecycle stages (soft-circle → verbal → signed → funded → closed):
//   soft_circle  — informal interest, no signed docs
//   verbal       — verbal commitment on record
//   signed       — subscription docs executed
//   funded       — capital wired / received
//   closed       — position booked; commitment is final
//   withdrawn    — investor pulled out before funded
//
// The `commitments` table does not have a lifecycle_stage column yet —
// migration 20260701230000 adds it. This module reads and writes that column.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type CommitmentStage =
  | "soft_circle"
  | "verbal"
  | "signed"
  | "funded"
  | "closed"
  | "withdrawn";

export interface CommitmentRecord {
  id: string;
  fund_id: string;
  investor_id: string;
  committed_amount: number;
  called_amount: number;
  distributed_amount: number;
  committed_at: string | null;
  lifecycle_stage: CommitmentStage;
  notes: string | null;
}

// Valid forward transitions. Backward movement is blocked; use "withdrawn" to
// pull a commitment regardless of current stage.
const VALID_TRANSITIONS: Record<CommitmentStage, CommitmentStage[]> = {
  soft_circle: ["verbal", "withdrawn"],
  verbal: ["signed", "withdrawn"],
  signed: ["funded", "withdrawn"],
  funded: ["closed", "withdrawn"],
  closed: [],
  withdrawn: [],
};

export interface AdvanceStageResult {
  ok: boolean;
  detail: string;
  stage?: CommitmentStage;
}

/**
 * Advance a commitment to the next stage (or mark withdrawn).
 * Enforces the valid-transition graph; returns ok:false for illegal moves.
 */
export async function advanceCommitmentStage(
  supabase: Client,
  commitmentId: string,
  toStage: CommitmentStage,
): Promise<AdvanceStageResult> {
  const { data: current } = await supabase
    .from("commitments")
    .select("lifecycle_stage")
    .eq("id", commitmentId)
    .maybeSingle();

  if (!current) {
    return { ok: false, detail: `Commitment ${commitmentId} not found.` };
  }

  const fromStage = (current.lifecycle_stage ?? "soft_circle") as CommitmentStage;
  const allowed = VALID_TRANSITIONS[fromStage];
  if (!allowed.includes(toStage)) {
    return {
      ok: false,
      detail: `Cannot move from "${fromStage}" to "${toStage}". Allowed: ${allowed.join(", ") || "none"}.`,
    };
  }

  const { error } = await supabase
    .from("commitments")
    .update({ lifecycle_stage: toStage })
    .eq("id", commitmentId);

  if (error) {
    return { ok: false, detail: `DB update failed: ${error.message}` };
  }

  return {
    ok: true,
    detail: `Commitment ${commitmentId} advanced from "${fromStage}" to "${toStage}".`,
    stage: toStage,
  };
}

export interface FundCommitmentSummary {
  fundId: string;
  totalCommitted: number;
  totalCalled: number;
  totalDistributed: number;
  byStage: Record<CommitmentStage, { count: number; amount: number }>;
  commitmentCount: number;
  closePercentage: number; // called / committed
}

/**
 * Aggregate commitment data for a fund — consumed by Capital Map and LP reports.
 */
export async function getFundCommitmentSummary(
  supabase: Client,
  fundId: string,
): Promise<FundCommitmentSummary | null> {
  const { data } = await supabase
    .from("commitments")
    .select("committed_amount, called_amount, distributed_amount, lifecycle_stage")
    .eq("fund_id", fundId);

  if (!data || data.length === 0) return null;

  const stages: CommitmentStage[] = [
    "soft_circle", "verbal", "signed", "funded", "closed", "withdrawn",
  ];
  const byStage = Object.fromEntries(
    stages.map((s) => [s, { count: 0, amount: 0 }]),
  ) as Record<CommitmentStage, { count: number; amount: number }>;

  let totalCommitted = 0;
  let totalCalled = 0;
  let totalDistributed = 0;

  for (const row of data) {
    const stage = (row.lifecycle_stage ?? "soft_circle") as CommitmentStage;
    byStage[stage].count++;
    byStage[stage].amount += row.committed_amount;
    totalCommitted += row.committed_amount;
    totalCalled += row.called_amount;
    totalDistributed += row.distributed_amount;
  }

  return {
    fundId,
    totalCommitted,
    totalCalled,
    totalDistributed,
    byStage,
    commitmentCount: data.length,
    closePercentage: totalCommitted > 0 ? totalCalled / totalCommitted : 0,
  };
}

/**
 * List all commitments for a fund, ordered by committed_amount descending.
 */
export async function listCommitments(
  supabase: Client,
  fundId: string,
): Promise<(Database["public"]["Tables"]["commitments"]["Row"] & { lifecycle_stage: CommitmentStage })[]> {
  const { data } = await supabase
    .from("commitments")
    .select("*")
    .eq("fund_id", fundId)
    .order("committed_amount", { ascending: false });

  return ((data ?? []) as unknown as (Database["public"]["Tables"]["commitments"]["Row"] & { lifecycle_stage: CommitmentStage })[]);
}

/**
 * Create a new soft-circle commitment entry.
 */
export async function createCommitment(
  supabase: Client,
  args: {
    orgId: string;
    fundId: string;
    investorId: string;
    committedAmount: number;
    notes?: string;
  },
): Promise<{ ok: boolean; id?: string; detail: string }> {
  const { data, error } = await supabase
    .from("commitments")
    .insert({
      organization_id: args.orgId,
      fund_id: args.fundId,
      investor_id: args.investorId,
      committed_amount: args.committedAmount,
      called_amount: 0,
      distributed_amount: 0,
      lifecycle_stage: "soft_circle" as CommitmentStage,
    } as Database["public"]["Tables"]["commitments"]["Insert"])
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, detail: error?.message ?? "Insert failed." };
  }

  return { ok: true, id: data.id, detail: `Soft-circle commitment created for investor ${args.investorId}.` };
}
