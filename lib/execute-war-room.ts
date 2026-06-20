// Execute-hub per-asset war room: everything about one portfolio holding in a
// single place — what it is and where it sits in its lifecycle, the value story
// (acquisition basis vs current mark, unrealized gain, gross MOIC, operating
// yield), the source deal it came from and the fund it sits in, the capital that
// has flowed around it, and the next best operating moves. This is the
// drill-down behind every asset chip in the Execute command center, mirroring
// the Run-hub deal war room and the Source-hub LP war room.
import { createServerClient } from "@/lib/supabase/server";
import { isExited } from "@/lib/execute-performance";
import type { Asset, CapitalEvent, Fund, Deal } from "@/lib/supabase/database.types";

// Where a holding sits in its arc: still to be acquired, held and being operated,
// or realized (exited). Drives the header badge and the next-best-action set.
export type LifecycleStage = "pre_acquisition" | "held" | "exited";

// A single recommended operating move on this asset, tied to the module it lives
// in so the UI can both label and link it.
export interface AssetNextAction {
  key: string;
  label: string;
  rationale: string;
  href: string;
}

export interface AssetWarRoom {
  asset: Asset;
  fund: Fund | null;
  deal: Deal | null;
  // Value story (all null-safe — a freshly-added, unmarked asset has no MOIC).
  moic: number | null; // current_value / acquisition_cost
  unrealizedGain: number | null; // current_value − acquisition_cost
  deploymentNote: string; // one-line read of cost deployed vs marked
  lifecycleStage: LifecycleStage;
  capitalEvents: CapitalEvent[];
  nextActions: AssetNextAction[];
}

// --- Pure helpers (unit-tested in execute-war-room.test.ts) -----------------

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Gross MOIC on a single asset: current value over acquisition cost. Null-safe —
 * returns null when either figure is missing or the cost basis is zero (so we
 * never divide by zero or report a meaningless multiple). Rounded to 2dp.
 */
export function assetMoic(cost: number | null | undefined, value: number | null | undefined): number | null {
  if (!isNum(cost) || !isNum(value) || cost <= 0) return null;
  return Math.round((value / cost) * 100) / 100;
}

/**
 * Unrealized gain on a single asset: current mark minus acquisition basis. Null
 * when either side is unknown — an unmarked or basis-less holding has no
 * meaningful gain to report (distinct from a real $0 gain).
 */
export function unrealizedGain(
  cost: number | null | undefined,
  value: number | null | undefined,
): number | null {
  if (!isNum(cost) || !isNum(value)) return null;
  return value - cost;
}

/**
 * Lifecycle stage from status + dates. An exit status (or a written-off mark)
 * is realized; otherwise a holding with an acquisition date / basis is held; a
 * holding with neither is still pre-acquisition (committed but not yet closed).
 */
export function assetLifecycleStage(asset: Asset): LifecycleStage {
  if (isExited(asset.status)) return "exited";
  if (asset.acquisition_date || isNum(asset.acquisition_cost)) return "held";
  return "pre_acquisition";
}

/**
 * Format an amount as a compact currency string (e.g. $1.2M, $850K, $2.4B).
 * Used across the war-room panels for cost / mark / gain / flow figures.
 */
export function formatCompactCurrency(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// Drop a trailing ".0" so whole numbers read cleanly ($2M, not $2.0M).
function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * A one-line read of where the holding's value stands: basis deployed, current
 * mark, and the gain/loss the mark implies. Pure over the asset's own numbers.
 */
export function deploymentNote(asset: Asset): string {
  const cost = asset.acquisition_cost;
  const value = asset.current_value;
  if (!isNum(cost) || cost <= 0) {
    return isNum(value) && value > 0
      ? `Marked at ${formatCompactCurrency(value)} — no acquisition basis on record yet.`
      : "No acquisition basis or mark on record yet.";
  }
  if (!isNum(value)) {
    return `${formatCompactCurrency(cost)} basis deployed — not yet marked to value.`;
  }
  const gain = value - cost;
  const verb = gain > 0 ? "up" : gain < 0 ? "down" : "flat";
  return `${formatCompactCurrency(cost)} basis · marked at ${formatCompactCurrency(value)} — ${verb} ${formatCompactCurrency(Math.abs(gain))}.`;
}

/**
 * Next best operating moves for one asset, ordered by leverage. Pure over the
 * asset's state + whether any capital events are on record, so the recommendation
 * set is unit-testable. Walks the operator's order: mark it, set/confirm the
 * basis, log the capital around it, then (once held and marked) plan the exit.
 */
export function assetNextActions(
  asset: Asset,
  stage: LifecycleStage,
  hasCapitalEvents: boolean,
): AssetNextAction[] {
  const actions: AssetNextAction[] = [];
  const cost = asset.acquisition_cost;
  const value = asset.current_value;

  if (stage === "exited") {
    actions.push({
      key: "record_exit",
      label: "Record the realized proceeds and close the position",
      rationale: "This holding has exited — log the final distribution so DPI reflects it.",
      href: "/execute/capital_events",
    });
    if (!hasCapitalEvents) {
      actions.push({
        key: "reconcile_flows",
        label: "Reconcile the capital flows behind this exit",
        rationale: "No capital events are tied to a realized asset yet.",
        href: "/execute/capital_events",
      });
    }
    return actions;
  }

  if (stage === "pre_acquisition") {
    actions.push({
      key: "confirm_close",
      label: "Confirm the close and set the acquisition basis",
      rationale: "No acquisition date or cost on record — this holding isn't on the book yet.",
      href: "/execute/asset_management",
    });
    return actions;
  }

  // Held.
  if (!isNum(value) || value <= 0) {
    actions.push({
      key: "mark_value",
      label: "Mark this holding to current value",
      rationale: "An unmarked asset carries no NAV and no MOIC — set the current mark.",
      href: "/execute/asset_management",
    });
  }
  if (!isNum(cost) || cost <= 0) {
    actions.push({
      key: "set_basis",
      label: "Set the acquisition cost basis",
      rationale: "Without a basis the gross multiple can't be computed.",
      href: "/execute/asset_management",
    });
  }
  if (!hasCapitalEvents) {
    actions.push({
      key: "log_flows",
      label: "Log the capital calls and distributions for this asset",
      rationale: "No capital events are tied to this holding yet.",
      href: "/execute/capital_events",
    });
  }
  if (asset.noi == null || asset.cap_rate == null) {
    actions.push({
      key: "set_yield",
      label: "Capture NOI and cap rate to track operating yield",
      rationale: "Yield metrics are missing — add them to monitor the income story.",
      href: "/execute/asset_management",
    });
  }
  // Once it's fully marked with a basis, the highest-leverage move is planning the exit.
  if (isNum(cost) && cost > 0 && isNum(value) && value > 0) {
    actions.push({
      key: "plan_exit",
      label: "Pressure-test the exit thesis at the current mark",
      rationale: "Marked and on basis — model the realization to lock in the multiple.",
      href: "/execute/exit",
    });
  }
  return actions;
}

// --- Assembly ---------------------------------------------------------------

/**
 * Assemble the full war room for one portfolio asset. Fetches the asset scoped
 * to the org (returns null if absent or not theirs), then in parallel: the fund
 * it sits in (if any), the source deal it came from (if any), and the capital
 * events tied to it — scoped first to this exact asset (by reference), falling
 * back to the asset's fund so the flows panel is never empty when only
 * fund-level events exist. Tenancy is enforced both by RLS and by an explicit
 * organization_id filter.
 */
export async function getAssetWarRoom(
  orgId: string,
  assetId: string,
): Promise<AssetWarRoom | null> {
  const supabase = createServerClient();

  const { data: assetRow } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const asset = assetRow as Asset | null;
  if (!asset) return null;

  // Fund, deal, and asset-referenced capital events — all in parallel. Each
  // optional lookup is gated on the foreign key actually being present.
  const [fundRes, dealRes, assetEventsRes] = await Promise.all([
    asset.fund_id
      ? supabase
          .from("funds")
          .select("*")
          .eq("id", asset.fund_id)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    asset.deal_id
      ? supabase
          .from("deals")
          .select("*")
          .eq("id", asset.deal_id)
          .eq("organization_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("capital_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("reference", assetId)
      .order("effective_date", { ascending: false })
      .limit(200),
  ]);

  const fund = (fundRes.data as Fund | null) ?? null;
  const deal = (dealRes.data as Deal | null) ?? null;

  // Prefer events referencing this exact asset; otherwise fall back to the
  // fund's capital events so the flows panel has context to show.
  let capitalEvents = (assetEventsRes.data ?? []) as CapitalEvent[];
  if (capitalEvents.length === 0 && asset.fund_id) {
    const { data: fundEvents } = await supabase
      .from("capital_events")
      .select("*")
      .eq("organization_id", orgId)
      .eq("fund_id", asset.fund_id)
      .order("effective_date", { ascending: false })
      .limit(200);
    capitalEvents = (fundEvents ?? []) as CapitalEvent[];
  }

  const moic = assetMoic(asset.acquisition_cost, asset.current_value);
  const gain = unrealizedGain(asset.acquisition_cost, asset.current_value);
  const lifecycleStage = assetLifecycleStage(asset);
  const nextActions = assetNextActions(asset, lifecycleStage, capitalEvents.length > 0);

  return {
    asset,
    fund,
    deal,
    moic,
    unrealizedGain: gain,
    deploymentNote: deploymentNote(asset),
    lifecycleStage,
    capitalEvents,
    nextActions,
  };
}
