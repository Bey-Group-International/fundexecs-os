// lib/source-stats.ts
// Pure, DB-free helpers that turn a Source module's already-fetched rows into a
// compact KPI strip and a stage/status distribution. Used by ModuleView so the
// Source modules read as live operating dashboards — not flat lists — with zero
// extra queries (everything is derived from the rows the page already loaded).
//
// The four operational anchors private-market operators actually live by:
//   • how much capital is in play vs. how many names      (LP / debt pipeline)
//   • where deals sit in the funnel                        (deal pipeline)
//   • how complete the operating bench is                  (partners / providers)
import { stageToTemperature } from "@/lib/capital-map";

export type Tone = "gold" | "success" | "info" | "muted" | "danger";

export interface Stat {
  label: string;
  value: string;
  /** Optional sub-line shown under the value (e.g. an estimate caveat). */
  hint?: string;
  tone?: Tone;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** 0–1 share of the busiest bucket, used for bar width. */
  share: number;
  tone: Tone;
}

export interface ModuleSummary {
  stats: Stat[];
  funnel: { title: string; stages: FunnelStage[] } | null;
}

// --- small coercion + format helpers ---------------------------------------
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function compactUsd(n: number | null): string {
  if (!n || n <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// A single investor's representative check, used to estimate capital in play.
// Midpoint when a band exists, otherwise whichever bound is present.
function checkEstimate(row: Record<string, unknown>): number {
  const lo = num(row.typical_check_min);
  const hi = num(row.typical_check_max);
  if (lo != null && hi != null) return (lo + hi) / 2;
  return hi ?? lo ?? 0;
}

// Build distribution bars from a fixed, ordered set of buckets so the funnel
// always reads left-to-right in lifecycle order (even for empty buckets).
function distribution(
  rows: Record<string, unknown>[],
  field: string,
  order: { key: string; label: string; tone: Tone }[],
  classify?: (raw: string) => string,
): FunnelStage[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = str(row[field]).toLowerCase();
    const key = classify ? classify(raw) : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = Math.max(1, ...order.map((o) => counts.get(o.key) ?? 0));
  return order.map((o) => {
    const count = counts.get(o.key) ?? 0;
    return { key: o.key, label: o.label, count, share: count / max, tone: o.tone };
  });
}

// --- canonical orderings ----------------------------------------------------
const LP_TEMPERATURE: { key: string; label: string; tone: Tone }[] = [
  { key: "cold", label: "Cold", tone: "muted" },
  { key: "warm", label: "Warm", tone: "info" },
  { key: "active", label: "Active", tone: "gold" },
  { key: "committed", label: "Committed", tone: "success" },
];

// Live deal funnel — terminal outcomes (passed / dead) are reported as a stat,
// not a funnel rung, so the bars stay a clean progression.
const DEAL_STAGES: { key: string; label: string; tone: Tone }[] = [
  { key: "sourced", label: "Sourced", tone: "muted" },
  { key: "screening", label: "Screening", tone: "info" },
  { key: "diligence", label: "Diligence", tone: "info" },
  { key: "underwriting", label: "Underwriting", tone: "gold" },
  { key: "ic_review", label: "IC Review", tone: "gold" },
  { key: "closing", label: "Closing", tone: "success" },
  { key: "owned", label: "Owned", tone: "success" },
];
const DEAL_DEAD = new Set(["passed", "dead"]);
const DEAL_CLOSED = new Set(["closing", "owned", "exited"]);

const PARTNER_STATUS: { key: string; label: string; tone: Tone }[] = [
  { key: "prospective", label: "Prospective", tone: "info" },
  { key: "active", label: "Active", tone: "success" },
  { key: "dormant", label: "Dormant", tone: "muted" },
  { key: "former", label: "Former", tone: "muted" },
];

const PROVIDER_TYPES: { key: string; label: string; tone: Tone }[] = [
  { key: "legal", label: "Legal", tone: "gold" },
  { key: "audit", label: "Audit", tone: "gold" },
  { key: "tax", label: "Tax", tone: "gold" },
  { key: "fund_admin", label: "Fund Admin", tone: "gold" },
  { key: "placement", label: "Placement", tone: "info" },
  { key: "bank", label: "Bank", tone: "info" },
  { key: "other", label: "Other", tone: "muted" },
];
// The categories an institutional LP expects a firm to have covered.
const PROVIDER_CORE = ["legal", "audit", "tax", "fund_admin"];

const FACILITY_STATUS: { key: string; label: string; tone: Tone }[] = [
  { key: "prospective", label: "Prospective", tone: "muted" },
  { key: "term_sheet", label: "Term Sheet", tone: "info" },
  { key: "committed", label: "Committed", tone: "gold" },
  { key: "drawn", label: "Drawn", tone: "success" },
  { key: "repaid", label: "Repaid", tone: "muted" },
  { key: "closed", label: "Closed", tone: "muted" },
];
const FACILITY_LIVE = new Set(["committed", "drawn"]);

// --- per-module summaries ---------------------------------------------------
// Keyed by the `${hub}/${module}` route key. Returns null for modules that have
// no dashboard treatment (the caller then renders the plain table alone).
export function summarizeModule(
  key: string,
  rows: Record<string, unknown>[],
): ModuleSummary | null {
  switch (key) {
    case "source/lp_pipeline": {
      const temps = rows.map((r) => stageToTemperature(str(r.pipeline_stage) || "prospect"));
      const live = rows.filter((_, i) => temps[i] === "active" || temps[i] === "committed");
      const inPlay = live.reduce((s, r) => s + checkEstimate(r), 0);
      const committed = temps.filter((t) => t === "committed").length;
      return {
        stats: [
          { label: "Investors", value: String(rows.length) },
          { label: "Active + circling", value: String(live.length), tone: "gold" },
          { label: "Committed", value: String(committed), tone: "success" },
          {
            label: "Capital in play",
            value: compactUsd(inPlay),
            hint: "est. from check sizes",
            tone: "gold",
          },
        ],
        funnel: {
          title: "Pipeline temperature",
          stages: distribution(rows, "pipeline_stage", LP_TEMPERATURE, (raw) =>
            stageToTemperature(raw || "prospect"),
          ),
        },
      };
    }

    case "source/deal_pipeline": {
      const stages = rows.map((r) => str(r.stage).toLowerCase());
      const dead = stages.filter((s) => DEAL_DEAD.has(s)).length;
      const live = rows.filter((_, i) => !DEAL_DEAD.has(stages[i]));
      const advancing = stages.filter((s) => DEAL_CLOSED.has(s)).length;
      const inPipeline = live.reduce((s, r) => s + (num(r.target_amount) ?? 0), 0);
      const fits = rows.map((r) => num(r.thesis_fit)).filter((n): n is number => n != null);
      const avgFit = fits.length ? Math.round(fits.reduce((s, n) => s + n, 0) / fits.length) : null;
      return {
        stats: [
          { label: "Live deals", value: String(live.length) },
          { label: "Closing / owned", value: String(advancing), tone: "success" },
          { label: "Capital at work", value: compactUsd(inPipeline), tone: "gold" },
          avgFit != null
            ? { label: "Avg thesis fit", value: `${avgFit}%`, tone: avgFit >= 60 ? "success" : "info" }
            : { label: "Passed / dead", value: String(dead), tone: "muted" },
        ],
        funnel: { title: "Deal funnel", stages: distribution(rows, "stage", DEAL_STAGES) },
      };
    }

    case "source/partners": {
      const active = rows.filter((r) => str(r.status).toLowerCase() === "active").length;
      const coGps = rows.filter((r) => /co.?gp/.test(str(r.partner_type).toLowerCase())).length;
      const types = new Set(rows.map((r) => str(r.partner_type).toLowerCase()).filter(Boolean));
      return {
        stats: [
          { label: "Partners", value: String(rows.length) },
          { label: "Active", value: String(active), tone: "success" },
          { label: "Co-GPs", value: String(coGps), tone: "gold" },
          { label: "Partner types", value: String(types.size) },
        ],
        funnel: { title: "Relationship status", stages: distribution(rows, "status", PARTNER_STATUS) },
      };
    }

    case "source/providers": {
      const active = rows.filter((r) => str(r.status).toLowerCase() === "active").length;
      const present = new Set(rows.map((r) => str(r.provider_type).toLowerCase()).filter(Boolean));
      const coreCovered = PROVIDER_CORE.filter((c) => present.has(c)).length;
      return {
        stats: [
          { label: "Providers", value: String(rows.length) },
          { label: "Active", value: String(active), tone: "success" },
          {
            label: "Core bench",
            value: `${coreCovered}/${PROVIDER_CORE.length}`,
            hint: "legal · audit · tax · admin",
            tone: coreCovered === PROVIDER_CORE.length ? "success" : "gold",
          },
          { label: "Categories", value: String(present.size) },
        ],
        funnel: { title: "Coverage by category", stages: distribution(rows, "provider_type", PROVIDER_TYPES) },
      };
    }

    case "source/debt": {
      const committed = rows.filter((r) => FACILITY_LIVE.has(str(r.status).toLowerCase()));
      const committedAmt = committed.reduce((s, r) => s + (num(r.commitment_amount) ?? 0), 0);
      const totalAmt = rows.reduce((s, r) => s + (num(r.commitment_amount) ?? 0), 0);
      const rates = rows.map((r) => num(r.interest_rate)).filter((n): n is number => n != null);
      const avgRate = rates.length ? rates.reduce((s, n) => s + n, 0) / rates.length : null;
      return {
        stats: [
          { label: "Facilities", value: String(rows.length) },
          { label: "Committed", value: compactUsd(committedAmt), tone: "success" },
          { label: "Total tracked", value: compactUsd(totalAmt), tone: "gold" },
          avgRate != null
            ? { label: "Avg rate", value: `${avgRate.toFixed(1)}%` }
            : { label: "Live facilities", value: String(committed.length) },
        ],
        funnel: { title: "Facility status", stages: distribution(rows, "status", FACILITY_STATUS) },
      };
    }

    default:
      return null;
  }
}

export const __test = { checkEstimate, distribution, humanize, compactUsd };
