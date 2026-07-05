// lib/proactive/pmi/carta.server.ts
// Carta — the first PMI source, wired end-to-end through the common interface.
//
// Carta powers fund performance vs peer cohort (Net IRR / TVPI / DPI percentile),
// NAV, cap tables, co-investors, 409a/FMV. For the proactive layer's first
// slice we implement `benchmark` (fund DPI/TVPI vs cohort — the LP-credibility
// claim) and `enrich` (an LP's comparable-fund activity).
//
// Runtime reality (reported honestly): the deployed Next.js app reaches external
// tools through Composio, not this session's MCP server. A live Carta pull needs
// a Composio Carta toolkit slug (config: CARTA_BENCHMARK_TOOL) or a per-org Carta
// connection. Until that lands, benchmark() degrades to a value DERIVED FROM THE
// ORG'S OWN track_records — real internal data — with the percentile modeled
// against a static cohort curve, and provenance marked `verified:false` and
// sourced as "carta·modeled" so a modeled estimate NEVER masquerades as a live
// Carta fact. The gate then forces any draft carrying it to investor-facing, so
// a human signs off before it leaves the building. This is the scaffolded seam;
// swapping in the live tool is a config change, not a rewrite.

import { createServiceClient } from "@/lib/supabase/server";
import type { VerifiedResult } from "@/lib/source-hub-types";
import {
  composioConfigForOrg,
  executeComposioTool,
} from "@/lib/integrations/composio/client.server";
import type {
  PmiSource,
  PmiBenchmark,
  PmiEnrichment,
  BenchmarkSpec,
  EnrichSpec,
} from "./types";

const PROVIDER = "carta";
const LIVE_ENDPOINT = "carta:dwh:execute:question";
const MODELED_ENDPOINT = "carta·modeled:track_records";

/** Config slug for a Composio Carta toolkit action; absent → modeled fallback. */
const CARTA_BENCHMARK_TOOL = process.env.CARTA_BENCHMARK_TOOL;

function nowIso(): string {
  return new Date().toISOString();
}

function failed<T>(error: string): VerifiedResult<T> {
  return {
    status: "failed",
    verified: false,
    confidence: 0,
    timestamp: nowIso(),
    sources: [],
    data: null as unknown as T,
    errors: [error],
  };
}

/**
 * Modeled cohort curve — maps a DPI/TVPI multiple to an approximate percentile
 * within a peer vintage. Deterministic and clearly a MODEL (not Carta cohort
 * data), so the claim it produces is labeled as an estimate. Replaced wholesale
 * once the live Carta cohort endpoint is connected.
 */
export function modeledPercentile(metric: string, value: number): number {
  const curve = metric === "dpi"
    ? [[1.5, 85], [1.0, 70], [0.6, 55], [0.3, 40], [0, 25]]
    : [[2.2, 85], [1.6, 70], [1.2, 55], [1.0, 40], [0, 25]]; // tvpi/moic
  for (const [floor, pct] of curve) if (value >= floor) return pct;
  return 20;
}

/** Compute fund-level DPI/TVPI from the org's track records. Real internal data. */
async function deriveFromTrackRecord(
  orgId: string,
  metric: string,
): Promise<{ value: number; asOf: string; cohort: string } | null> {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    return null; // no service-role key in this env
  }
  const { data, error } = await supabase
    .from("track_records")
    .select("invested_amount, realized_value, unrealized_value, vintage_year, asset_class, updated_at")
    .eq("organization_id", orgId);
  if (error || !data || data.length === 0) return null;

  let invested = 0;
  let realized = 0;
  let unrealized = 0;
  let latest = "";
  const vintages = new Set<number>();
  const classes = new Set<string>();
  for (const r of data as Array<Record<string, unknown>>) {
    invested += Number(r.invested_amount ?? 0);
    realized += Number(r.realized_value ?? 0);
    unrealized += Number(r.unrealized_value ?? 0);
    if (r.vintage_year) vintages.add(Number(r.vintage_year));
    if (r.asset_class) classes.add(String(r.asset_class));
    const u = String(r.updated_at ?? "");
    if (u > latest) latest = u;
  }
  if (invested <= 0) return null;

  const value = metric === "dpi" ? realized / invested : (realized + unrealized) / invested;
  const vintageLabel = vintages.size ? `${Math.min(...vintages)} vintage` : "your vintage";
  const classLabel = classes.size === 1 ? [...classes][0] : "multi-strategy";
  return {
    value: Math.round(value * 100) / 100,
    asOf: latest || nowIso(),
    cohort: `${vintageLabel}, ${classLabel} cohort`,
  };
}

export const cartaSource: PmiSource = {
  key: PROVIDER,
  label: "Carta",

  async available(orgId: string): Promise<boolean> {
    // Live only when a Composio Carta tool is configured AND the org can reach
    // Composio. Otherwise the source still produces modeled benchmarks, but
    // reports NOT-live so callers can label provenance correctly.
    if (!CARTA_BENCHMARK_TOOL) return false;
    const cfg = await composioConfigForOrg(orgId);
    return Boolean(cfg);
  },

  async benchmark(orgId: string, spec: BenchmarkSpec): Promise<VerifiedResult<PmiBenchmark>> {
    const metric = (spec.metric || "dpi").toLowerCase();
    const t0 = Date.now();

    // 1) Live path (scaffolded): a Composio Carta toolkit action.
    if (CARTA_BENCHMARK_TOOL) {
      const cfg = await composioConfigForOrg(orgId);
      if (cfg) {
        const res = await executeComposioTool<Record<string, unknown>>(cfg, CARTA_BENCHMARK_TOOL, {
          metric,
          cohort: spec.cohort ?? {},
        });
        if (res.ok && res.data && typeof res.data.value === "number") {
          const d = res.data;
          return {
            status: "success",
            verified: true,
            confidence: 0.9,
            timestamp: nowIso(),
            sources: [{
              provider: PROVIDER,
              endpoint: LIVE_ENDPOINT,
              latency_ms: Date.now() - t0,
              verified: true,
              retrieved_at: nowIso(),
            }],
            data: {
              metric,
              value: Number(d.value),
              unit: (d.unit as PmiBenchmark["unit"]) ?? (metric === "dpi" || metric === "tvpi" ? "x" : "pct"),
              percentile: d.percentile != null ? Number(d.percentile) : null,
              cohort: String(d.cohort ?? "Carta peer cohort"),
              asOf: String(d.as_of ?? nowIso()),
            },
          };
        }
        // Live attempt failed → fall through to modeled, don't fabricate.
      }
    }

    // 2) Modeled fallback — grounded in the org's real track record, percentile
    // estimated. Provenance is explicit that this is a model, not live Carta.
    const derived = await deriveFromTrackRecord(orgId, metric);
    if (!derived) return failed<PmiBenchmark>("No Carta connection and no track record to model from.");
    return {
      status: "warning", // usable, but not source-verified
      verified: false,
      confidence: 0.5,
      timestamp: nowIso(),
      sources: [{
        provider: "carta·modeled",
        endpoint: MODELED_ENDPOINT,
        latency_ms: Date.now() - t0,
        verified: false,
        retrieved_at: nowIso(),
      }],
      data: {
        metric,
        value: derived.value,
        unit: metric === "net_irr" ? "pct" : "x",
        percentile: modeledPercentile(metric, derived.value),
        cohort: derived.cohort,
        asOf: derived.asOf,
      },
    };
  },

  async enrich(orgId: string, spec: EnrichSpec): Promise<VerifiedResult<PmiEnrichment>> {
    // LP comparable-fund activity / co-investor overlap is a genuinely EXTERNAL
    // fact — we do not fabricate it. Live only via a connected Carta co-investor
    // endpoint; until then we return `failed` so the draft simply omits the
    // "committed to a comparable fund" claim rather than inventing it.
    void orgId;
    if (!CARTA_BENCHMARK_TOOL) {
      return failed<PmiEnrichment>(
        `Carta enrichment for ${spec.subjectName} requires a live Carta connection (co-investor endpoint not connected).`,
      );
    }
    // Live enrichment would map a co-investor/portfolio query here.
    return failed<PmiEnrichment>("Carta co-investor enrichment not yet implemented.");
  },
};
