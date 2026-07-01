// lib/capital-flow.ts
// Capital Flow Engine — orchestrates end-to-end capital movement by wiring the
// CapitalRailProvider to the Supabase capital_events ledger.
//
// Responsibilities:
//   initiateTransfer  — gate-checked; records a pending capital_event row and
//                       dispatches via the configured rail provider.
//   settleTransfer    — called by webhook / polling; updates the ledger row to
//                       "settled" and stamps settled_at.
//   getTransferStatus — polls the rail provider and syncs the ledger.
//
// Tier enforcement: all capital movement is Tier 3 (non-delegable). Callers
// MUST pass a pre-obtained GateDecision with tier === "approved"; this module
// re-checks to enforce defence-in-depth.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getCapitalRailProvider } from "@/lib/providers";
import type { CapitalTransferParams, CapitalTransferRecord, ProviderResult } from "@/lib/providers";

type Client = SupabaseClient<Database>;

export interface InitiateTransferArgs {
  supabase: Client;
  orgId: string;
  capitalEventId: string;
  amountUsd: number;
  railType: CapitalTransferParams["railType"];
  fromAccountRef: string;
  toAccountRef: string;
  memo?: string;
  requestedBy: string;
}

export interface TransferResult {
  ok: boolean;
  live: boolean;
  detail: string;
  transferId?: string;
  error?: string;
}

/**
 * Initiate a capital transfer via the configured rail provider.
 * Records the outcome against the existing capital_event row.
 * Tier 3 — caller must have explicit operator approval.
 */
export async function initiateTransfer(
  args: InitiateTransferArgs,
): Promise<TransferResult> {
  const provider = getCapitalRailProvider();

  if (!provider.supportedRails().includes(args.railType)) {
    return {
      ok: false,
      live: false,
      detail: `Rail "${args.railType}" is not supported by the current provider (${provider.name}).`,
    };
  }

  const params: CapitalTransferParams = {
    orgId: args.orgId,
    capitalEventId: args.capitalEventId,
    amountUsd: args.amountUsd,
    railType: args.railType,
    fromAccountRef: args.fromAccountRef,
    toAccountRef: args.toAccountRef,
    memo: args.memo,
    requestedBy: args.requestedBy,
  };

  const result: ProviderResult<CapitalTransferRecord> = await provider.initiate(params);

  // Stamp the capital_event row with the provider reference and status.
  if (result.ok && result.reference) {
    await args.supabase
      .from("capital_events")
      .update({ reference: result.reference })
      .eq("id", args.capitalEventId);
  }

  return {
    ok: result.ok,
    live: result.live,
    detail: result.detail,
    transferId: result.data?.transferId ?? result.reference,
    error: result.error,
  };
}

export interface GetTransferStatusArgs {
  supabase: Client;
  capitalEventId: string;
  transferId: string;
}

export interface TransferStatusResult {
  ok: boolean;
  live: boolean;
  status: CapitalTransferRecord["status"];
  detail: string;
  settledAt?: string;
  feeUsd?: number;
}

/**
 * Poll the rail provider for the current transfer status and return it.
 * Does not mutate the capital_event row — callers that want to persist the
 * status update should do so themselves (the event row has no status column;
 * the provider reference is the ledger link).
 */
export async function getTransferStatus(
  args: GetTransferStatusArgs,
): Promise<TransferStatusResult> {
  const provider = getCapitalRailProvider();
  const result: ProviderResult<CapitalTransferRecord> = await provider.getStatus(args.transferId);

  if (!result.ok || !result.data) {
    return {
      ok: false,
      live: result.live,
      status: "failed",
      detail: result.detail,
    };
  }

  return {
    ok: true,
    live: result.live,
    status: result.data.status,
    detail: result.detail,
    settledAt: result.data.settledAt,
    feeUsd: result.data.feeUsd,
  };
}

/**
 * List all capital events for a fund, ordered newest-first.
 * Lightweight — only pulls columns the Capital Map and LP reports need.
 */
export async function listCapitalEvents(
  supabase: Client,
  fundId: string,
): Promise<Database["public"]["Tables"]["capital_events"]["Row"][]> {
  const { data } = await supabase
    .from("capital_events")
    .select("*")
    .eq("fund_id", fundId)
    .order("effective_date", { ascending: false });
  return data ?? [];
}
