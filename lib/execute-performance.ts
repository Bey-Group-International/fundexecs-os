// Execute-hub performance: turns the post-close operating record (portfolio
// holdings + their marks, and the capital that has flowed in and back out) into
// the single picture an operator and their LPs lead with — NAV, the paid-in /
// returned ledger, and the standard PE multiples (TVPI, DPI, RVPI, gross MOIC).
//
// This is what makes the Execute hub *compound*: every fresh mark, every capital
// call logged, every distribution recorded moves a visible value meter, advances
// the portfolio along its lifecycle (Deploying → Operating → Harvesting →
// Realized), and resurfaces the single highest-leverage next move.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { Asset, CapitalEvent, Fund } from "@/lib/supabase/database.types";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

// Asset states that have left the held portfolio — they no longer carry NAV.
const EXITED_STATES = new Set(["exited", "sold", "realized", "divested", "written_off"]);

/** Whether an asset's status puts it outside the held portfolio (a realized exit). */
export function isExited(status: string | null | undefined): boolean {
  return EXITED_STATES.has((status ?? "").toLowerCase());
}

// Capital flowing in (paid-in) vs back out (returned), by event type.
const INFLOW = new Set(["capital_call", "contribution"]);
const OUTFLOW = new Set(["distribution", "return_of_capital", "carry"]);

export interface ExecuteStage {
  key: "pre" | "deploying" | "operating" | "harvesting" | "realized";
  label: string;
  blurb: string;
}

export interface ExecuteModuleChip {
  key: string;
  label: string;
  href: string;
  count: number;
  status: "empty" | "started" | "complete";
}

export interface ExecuteNextAction {
  label: string;
  href: string;
  moduleLabel: string;
}

export interface ExecutePerformance {
  hasData: boolean;
  // Value
  nav: number; // marked value of held assets
  cost: number; // acquisition cost basis of held assets
  unrealizedGain: number; // nav - cost
  // Capital ledger
  committed: number;
  called: number; // paid-in
  distributed: number; // returned to LPs
  netCashflow: number; // distributed - called
  deploymentPct: number | null; // called / committed, 0–100
  // Multiples
  tvpi: number | null; // (distributed + nav) / called
  dpi: number | null; // distributed / called
  rvpi: number | null; // nav / called
  grossMoic: number | null; // nav / cost on held assets
  // Hero (ring): TVPI when there's capital, else held-asset gross MOIC
  heroMultiple: number | null;
  heroLabel: "TVPI" | "Gross MOIC";
  // Portfolio shape
  assetCount: number;
  activeAssets: number;
  exitedAssets: number;
  topAsset: { name: string; multiple: number } | null;
  upcomingCall: { amount: number; date: string } | null;
  // Roll-up
  stage: ExecuteStage;
  stages: { stage: ExecuteStage; current: boolean; reached: boolean }[];
  modules: ExecuteModuleChip[];
  nextAction: ExecuteNextAction | null;
}

const STAGE_ORDER: ExecuteStage[] = [
  { key: "deploying", label: "Deploying", blurb: "Capital going to work — holdings coming onto the book." },
  { key: "operating", label: "Operating", blurb: "Assets held and marked — driving value creation." },
  { key: "harvesting", label: "Harvesting", blurb: "Capital coming back — distributions are flowing to LPs." },
  { key: "realized", label: "Realized", blurb: "Paid-in capital returned — the fund is in the money." },
];

const PRE_STAGE: ExecuteStage = {
  key: "pre",
  label: "Pre-deployment",
  blurb: "No holdings on the book yet — add your first asset to start the record.",
};

function chip(key: string, label: string, count: number): ExecuteModuleChip {
  const status: ExecuteModuleChip["status"] =
    count === 0 ? "empty" : count >= 3 ? "complete" : "started";
  return { key, label, href: `/execute/${key}`, count, status };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Pure roll-up: given the raw operating record, assemble the portfolio
 * performance view, lifecycle stage, per-module presence, and next-best move.
 * No I/O — kept separate from the fetch so the math stays unit-testable.
 */
export function rollupExecutePerformance(
  assets: Asset[],
  events: CapitalEvent[],
  funds: Fund[],
): ExecutePerformance {
  const held = assets.filter((a) => !EXITED_STATES.has((a.status ?? "").toLowerCase()));
  const exited = assets.filter((a) => EXITED_STATES.has((a.status ?? "").toLowerCase()));

  const nav = held.reduce((s, a) => s + num(a.current_value), 0);
  const cost = held.reduce((s, a) => s + num(a.acquisition_cost), 0);
  const unrealizedGain = nav - cost;

  // Capital ledger — prefer the fund aggregates when present, otherwise derive
  // from the capital-events ledger so the picture works either way.
  const fundsCommitted = funds.reduce((s, f) => s + num(f.committed_capital), 0);
  const fundsTarget = funds.reduce((s, f) => s + num(f.target_size), 0);
  const fundsCalled = funds.reduce((s, f) => s + num(f.called_capital), 0);
  const fundsDistributed = funds.reduce((s, f) => s + num(f.distributed_capital), 0);

  const callsFromEvents = events
    .filter((e) => INFLOW.has(e.event_type))
    .reduce((s, e) => s + num(e.amount), 0);
  const distFromEvents = events
    .filter((e) => OUTFLOW.has(e.event_type))
    .reduce((s, e) => s + num(e.amount), 0);

  const called = fundsCalled > 0 ? fundsCalled : callsFromEvents;
  const distributed = fundsDistributed > 0 ? fundsDistributed : distFromEvents;
  const committed = fundsCommitted > 0 ? fundsCommitted : fundsTarget > 0 ? fundsTarget : called;
  const netCashflow = distributed - called;
  const deploymentPct =
    committed > 0 ? Math.min(100, Math.round((called / committed) * 100)) : null;

  // Multiples — paid-in = called.
  const tvpi = called > 0 ? round2((distributed + nav) / called) : null;
  const dpi = called > 0 ? round2(distributed / called) : null;
  const rvpi = called > 0 ? round2(nav / called) : null;
  const grossMoic = cost > 0 ? round2(nav / cost) : null;

  const heroMultiple = tvpi ?? grossMoic;
  const heroLabel: "TVPI" | "Gross MOIC" = tvpi != null ? "TVPI" : "Gross MOIC";

  // Best-marked holding — the one carrying the strongest multiple right now.
  let topAsset: ExecutePerformance["topAsset"] = null;
  for (const a of held) {
    const c = num(a.acquisition_cost);
    const v = num(a.current_value);
    if (c > 0 && v > 0) {
      const m = round2(v / c);
      if (!topAsset || m > topAsset.multiple) topAsset = { name: a.name, multiple: m };
    }
  }

  // Next capital call coming due.
  const today = new Date().toISOString().slice(0, 10);
  let upcomingCall: ExecutePerformance["upcomingCall"] = null;
  for (const e of events) {
    if (e.event_type !== "capital_call") continue;
    const due = e.due_date ?? e.effective_date;
    if (!due || due < today) continue;
    if (!upcomingCall || due < upcomingCall.date) upcomingCall = { amount: num(e.amount), date: due };
  }

  // Lifecycle stage.
  let stage: ExecuteStage;
  if (assets.length === 0) stage = PRE_STAGE;
  else if (dpi != null && dpi >= 1) stage = STAGE_ORDER[3];
  else if (dpi != null && dpi >= 0.25) stage = STAGE_ORDER[2];
  else if (nav > 0 || (deploymentPct != null && deploymentPct >= 60)) stage = STAGE_ORDER[1];
  else stage = STAGE_ORDER[0];

  const reachedIdx = stage.key === "pre" ? -1 : STAGE_ORDER.findIndex((s) => s.key === stage.key);
  const stages = STAGE_ORDER.map((s, i) => ({
    stage: s,
    current: s.key === stage.key,
    reached: i <= reachedIdx,
  }));

  const modules: ExecuteModuleChip[] = [
    chip("closing", "Closing", 0),
    chip("capital_events", "Capital Events", events.length),
    chip("asset_management", "Asset Management", assets.length),
    chip("reporting", "Reporting", 0),
    chip("exit", "Exit", exited.length),
  ];

  // Next best move — walk the operator's order: get holdings on the book, mark
  // them, set the deployment target, then run the capital ledger.
  let nextAction: ExecuteNextAction | null = null;
  const set = (label: string, href: string, moduleLabel: string) => {
    if (!nextAction) nextAction = { label, href, moduleLabel };
  };
  if (assets.length === 0) {
    set("Add your first portfolio asset to start the book", "/execute/asset_management", "Asset Management");
  } else if (nav === 0 && cost >= 0) {
    set("Mark your holdings to current value", "/execute/asset_management", "Asset Management");
  } else if (events.length === 0) {
    set("Record capital calls and distributions", "/execute/capital_events", "Capital Events");
  } else if (upcomingCall) {
    set("A capital call is coming due — confirm and notify LPs", "/execute/capital_events", "Capital Events");
  } else if (committed > 0 && deploymentPct != null && deploymentPct < 100) {
    set("Deploy remaining commitments or log the next call", "/execute/capital_events", "Capital Events");
  } else if (distributed === 0) {
    set("No distributions yet — log returns as capital comes back", "/execute/capital_events", "Capital Events");
  }

  return {
    hasData: assets.length > 0 || events.length > 0 || funds.length > 0,
    nav,
    cost,
    unrealizedGain,
    committed,
    called,
    distributed,
    netCashflow,
    deploymentPct,
    tvpi,
    dpi,
    rvpi,
    grossMoic,
    heroMultiple,
    heroLabel,
    assetCount: assets.length,
    activeAssets: held.length,
    exitedAssets: exited.length,
    topAsset,
    upcomingCall,
    stage,
    stages,
    modules,
    nextAction,
  };
}

/**
 * Compute Execute-hub performance for an org. Pulls the operating record
 * (assets + capital events + funds) in parallel, then hands off to the pure
 * roll-up. Memoized per request so the hub layout and module views collapse
 * into a single set of queries.
 */
export const getExecutePerformance = cache(async function getExecutePerformance(
  orgId: string,
): Promise<ExecutePerformance> {
  const supabase = await createServerClient();

  const [assetsRes, eventsRes, fundsRes] = await Promise.all([
    supabase.from("assets").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("capital_events").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("funds").select("*").eq("organization_id", orgId),
  ]);

  return rollupExecutePerformance(
    (assetsRes.data ?? []) as Asset[],
    (eventsRes.data ?? []) as CapitalEvent[],
    (fundsRes.data ?? []) as Fund[],
  );
});
