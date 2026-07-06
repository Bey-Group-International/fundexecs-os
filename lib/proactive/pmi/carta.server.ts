// lib/proactive/pmi/carta.server.ts
// Carta — the first PMI source, wired end-to-end through the common interface.
//
// Carta powers fund performance vs peer cohort (Net IRR / TVPI / DPI percentile),
// NAV, cap tables, co-investors, 409a/FMV. For the proactive layer's first
// slice we implement `benchmark` (fund DPI/TVPI vs cohort — the LP-credibility
// claim) and `enrich` (an LP's comparable-fund activity, scaffolded).
//
// LIVE PATH: the deployed app reaches Carta through Carta's MCP endpoint
// (lib/integrations/carta/mcp-client.server.ts) — JSON-RPC over HTTP, no SDK.
// It is active when CARTA_MCP_URL is set AND the org has a CARTA_MCP_TOKEN in
// the vault. Then benchmark() calls Carta's read tool and maps a STRUCTURED
// result into PmiBenchmark with verified:true.
//
// FALLBACK: with no Carta connection, benchmark() derives the value from the
// org's own track_records — real internal data — with the percentile modeled
// against a static curve, and provenance marked verified:false / "carta·modeled"
// so a modeled estimate NEVER masquerades as a live Carta fact. The gate then
// forces any draft carrying it to investor-facing. Swapping from modeled to live
// is a config + token change, not a rewrite.

import { createServiceClient } from "@/lib/supabase/server";
import type { VerifiedResult } from "@/lib/source-hub-types";
import {
  cartaMcpConfigForOrg,
  callCartaTool,
  CARTA_MCP_TOOL,
} from "@/lib/integrations/carta/mcp-client.server";
import type {
  PmiSource,
  PmiBenchmark,
  PmiEnrichment,
  BenchmarkSpec,
  EnrichSpec,
} from "./types";

const PROVIDER = "carta";
const LIVE_ENDPOINT = "carta:mcp";
const MODELED_ENDPOINT = "carta·modeled:track_records";

/**
 * The Carta command the benchmark read runs. Carta's data-warehouse question
 * tool (`dwh:execute:question`) answers fund-performance questions in NL; a firm
 * that prefers a structured command can override this. The exact command is the
 * one integration-specific value a human confirms against their Carta account.
 */
const CARTA_BENCHMARK_COMMAND = process.env.CARTA_BENCHMARK_COMMAND ?? "dwh:execute:question";

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

/** The natural-language question posed to Carta's warehouse for a metric. */
export function questionForMetric(metric: string, cohort?: Record<string, string | number>): string {
  const scope = cohort && Object.keys(cohort).length
    ? ` for the ${Object.values(cohort).join(", ")} cohort`
    : "";
  const label = metric.toUpperCase();
  return `What is our fund's ${label} and its percentile versus comparable funds${scope}? Return the value, unit, percentile, cohort label, and as-of date.`;
}

/** Coerce a possibly-stringy numeric field to a number, or null. Pure. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Map a structured Carta tool result into PmiBenchmark. Tolerant of shape
 * (nested `data`, string numbers, snake/camel keys). Returns null when there is
 * no usable numeric value — the caller then falls back to modeled rather than
 * emitting an empty live claim. Pure + tested.
 */
export function mapCartaBenchmark(raw: unknown, metric: string): PmiBenchmark | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const body = (o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : o);

  const value = num(body.value ?? body.metric_value ?? body[metric]);
  if (value == null) return null;

  const percentile = num(body.percentile ?? body.percentile_rank ?? body.rank);
  const unitRaw = String(body.unit ?? "").toLowerCase();
  const unit: PmiBenchmark["unit"] =
    unitRaw === "pct" || unitRaw === "%" || metric === "net_irr" ? "pct"
    : unitRaw === "usd" || unitRaw === "$" ? "usd"
    : "x";

  return {
    metric,
    value,
    unit,
    percentile,
    cohort: String(body.cohort ?? body.cohort_label ?? "Carta peer cohort"),
    asOf: String(body.as_of ?? body.asOf ?? body.as_of_date ?? nowIso()),
  };
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

/**
 * Modeled cohort curve — maps a DPI/TVPI multiple to an approximate percentile
 * within a peer vintage. Deterministic and clearly a MODEL (not Carta cohort
 * data). Replaced wholesale once the live Carta cohort endpoint is connected.
 */
export function modeledPercentile(metric: string, value: number): number {
  const curve = metric === "dpi"
    ? [[1.5, 85], [1.0, 70], [0.6, 55], [0.3, 40], [0, 25]]
    : [[2.2, 85], [1.6, 70], [1.2, 55], [1.0, 40], [0, 25]]; // tvpi/moic
  for (const [floor, pct] of curve) if (value >= floor) return pct;
  return 20;
}

export const cartaSource: PmiSource = {
  key: PROVIDER,
  label: "Carta",

  async available(orgId: string): Promise<boolean> {
    // Live only when the Carta MCP endpoint + a per-org token both resolve.
    // Otherwise the source still produces modeled benchmarks, but reports
    // NOT-live so callers can label provenance correctly.
    return Boolean(await cartaMcpConfigForOrg(orgId));
  },

  async benchmark(orgId: string, spec: BenchmarkSpec): Promise<VerifiedResult<PmiBenchmark>> {
    const metric = (spec.metric || "dpi").toLowerCase();
    const t0 = Date.now();

    // 1) Live path — Carta MCP. Active when the endpoint + token are configured.
    const cfg = await cartaMcpConfigForOrg(orgId);
    if (cfg) {
      const res = await callCartaTool<unknown>(cfg, CARTA_MCP_TOOL, {
        command: CARTA_BENCHMARK_COMMAND,
        question: questionForMetric(metric, spec.cohort),
        metric,
        cohort: spec.cohort ?? {},
      });
      if (res.ok) {
        const mapped = mapCartaBenchmark(res.data, metric);
        if (mapped) {
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
            data: mapped,
          };
        }
      }
      // Live attempt failed or unmappable → fall through to modeled, never fabricate.
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
    // read; until that command is wired we return `failed` so the draft simply
    // omits the "committed to a comparable fund" claim rather than inventing it.
    void orgId;
    void spec;
    return failed<PmiEnrichment>(
      "Carta co-investor enrichment requires a live Carta connection (endpoint not yet wired).",
    );
  },
};
