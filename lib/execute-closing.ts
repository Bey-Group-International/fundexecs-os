// Execute-hub closing process: the bridge from a committed deal to a portfolio
// holding. Turns each deal heading to close into a tracked close — a checklist
// of the steps that actually gate a wire (IC approval, diligence cleared, legal
// & admin engaged, funding secured, close date set) with live progress — so the
// close is a process an operator drives, not a status they wait on.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import type { Deal, DiligenceItem, ServiceProvider, Fund } from "@/lib/supabase/database.types";

const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

// Deals actively closing (post-IC) or awaiting the committee.
const CLOSING_STAGES = new Set<Deal["stage"]>(["ic_review", "closing"]);
const DILIGENCE_RESOLVED = new Set(["cleared", "waived"]);
const SEVERE = new Set(["high", "critical"]);
const LEGAL_PROVIDERS = new Set(["legal", "fund_admin", "audit"]);
const ACTIVE_PROVIDER = new Set(["active", "engaged", "retained"]);

export interface CloseStep {
  key: string;
  label: string;
  done: boolean;
  /** Imperative phrasing for when this step is the next one to clear. */
  action: string;
}

export interface DealClose {
  deal: Deal;
  steps: CloseStep[];
  doneCount: number;
  total: number;
  progress: number; // 0–100
  ready: boolean; // every step cleared
  fundName: string | null;
  daysToClose: number | null; // negative = overdue
  nextStep: CloseStep | null;
}

export interface ClosingSummary {
  closes: DealClose[];
  inClosing: number; // stage = closing
  awaitingIc: number; // stage = ic_review
  capitalClosing: number; // Σ target_amount across closing
  avgReadiness: number; // 0–100 across all closes
  readyCount: number;
  nextClose: { name: string; date: string; days: number } | null;
  overdue: number;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

function scoreClose(
  deal: Deal,
  diligence: DiligenceItem[],
  hasLegalBench: boolean,
  fundName: string | null,
): DealClose {
  const items = diligence.filter((d) => d.deal_id === deal.id);
  const resolved = items.filter((d) => DILIGENCE_RESOLVED.has(d.status));
  const coverage = items.length ? resolved.length / items.length : 0;
  const openSevere = items.some(
    (d) => !DILIGENCE_RESOLVED.has(d.status) && d.risk_severity != null && SEVERE.has(d.risk_severity),
  );

  const steps: CloseStep[] = [
    {
      key: "ic",
      label: "IC approved",
      done: deal.stage === "closing",
      action: "Clear the deal through investment committee",
    },
    {
      key: "diligence",
      label: "Diligence cleared",
      done: items.length > 0 && coverage >= 0.8 && !openSevere,
      action: "Close out the open diligence items",
    },
    {
      key: "advisors",
      label: "Legal & admin engaged",
      done: hasLegalBench,
      action: "Engage legal and fund admin for the close",
    },
    {
      key: "funding",
      label: "Funding secured",
      done: deal.fund_id != null,
      action: "Assign the deal to a fund and line up capital",
    },
    {
      key: "date",
      label: "Close date set",
      done: deal.expected_close != null,
      action: "Set a target close date",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);
  const nextStep = steps.find((s) => !s.done) ?? null;

  return {
    deal,
    steps,
    doneCount,
    total: steps.length,
    progress,
    ready: doneCount === steps.length,
    fundName,
    daysToClose: daysUntil(deal.expected_close),
    nextStep,
  };
}

/**
 * Pure roll-up: given the working set, score each close and assemble the summary.
 * No I/O — kept separate from the fetch so the process logic is unit-testable.
 */
export function rollupExecuteClosing(
  deals: Deal[],
  diligence: DiligenceItem[],
  providers: ServiceProvider[],
  funds: Fund[],
): ClosingSummary {
  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  const hasLegalBench = providers.some(
    (p) => LEGAL_PROVIDERS.has((p.provider_type ?? "").toLowerCase()) && ACTIVE_PROVIDER.has((p.status ?? "").toLowerCase()),
  );

  const working = deals.filter((d) => CLOSING_STAGES.has(d.stage));
  const closes = working
    .map((d) => scoreClose(d, diligence, hasLegalBench, d.fund_id ? fundName.get(d.fund_id) ?? null : null))
    .sort((a, b) => {
      // Closing before awaiting-IC; then most-ready first; then soonest close.
      if (a.deal.stage !== b.deal.stage) return a.deal.stage === "closing" ? -1 : 1;
      if (a.progress !== b.progress) return b.progress - a.progress;
      const ad = a.deal.expected_close ?? "9999";
      const bd = b.deal.expected_close ?? "9999";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

  const closing = closes.filter((c) => c.deal.stage === "closing");
  const capitalClosing = closing.reduce((s, c) => s + num(c.deal.target_amount), 0);
  const avgReadiness = closes.length
    ? Math.round(closes.reduce((s, c) => s + c.progress, 0) / closes.length)
    : 0;

  const dated = closing
    .filter((c) => c.deal.expected_close)
    .sort((a, b) => (a.deal.expected_close! < b.deal.expected_close! ? -1 : 1));
  const next = dated[0];
  const nextClose = next
    ? { name: next.deal.name, date: next.deal.expected_close!, days: next.daysToClose ?? 0 }
    : null;
  const overdue = closing.filter((c) => c.daysToClose != null && c.daysToClose < 0).length;

  return {
    closes,
    inClosing: closing.length,
    awaitingIc: closes.length - closing.length,
    capitalClosing,
    avgReadiness,
    readyCount: closes.filter((c) => c.ready).length,
    nextClose,
    overdue,
  };
}

/**
 * Compute the Execute-hub closing picture for an org. Pulls the deal working set
 * plus the diligence, service bench, and funds it depends on, in parallel.
 */
export const getExecuteClosing = cache(async function getExecuteClosing(
  orgId: string,
): Promise<ClosingSummary> {
  const supabase = createServerClient();
  const [dealsRes, dilRes, provRes, fundRes] = await Promise.all([
    supabase.from("deals").select("*").eq("organization_id", orgId).in("stage", ["ic_review", "closing"]),
    supabase.from("diligence_items").select("*").eq("organization_id", orgId),
    supabase.from("service_providers").select("*").eq("organization_id", orgId),
    supabase.from("funds").select("*").eq("organization_id", orgId),
  ]);

  return rollupExecuteClosing(
    (dealsRes.data ?? []) as Deal[],
    (dilRes.data ?? []) as DiligenceItem[],
    (provRes.data ?? []) as ServiceProvider[],
    (fundRes.data ?? []) as Fund[],
  );
});
