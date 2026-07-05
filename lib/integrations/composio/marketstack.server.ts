// Company / market facts via Marketstack — executed THROUGH Composio.
//
// Marketstack is connected inside Composio (its API key lives in the Composio
// connected account), so the app calls Marketstack via Composio's tool-execute
// endpoint and Composio injects the credential. This is driven by the same
// COMPOSIO_API_KEY the rest of the layer uses — there is no separate Marketstack
// key in the app.
//
// Given a ticker or company name we resolve the registrant's market identity
// (name, symbol, exchange) and, best-effort, its latest EOD close, then emit the
// same `ExtractedDataPoint[]` the review queue understands. The EDGAR *filings*
// are discovered separately via Google web search (edgar-search.server.ts).
//
// The Composio Marketstack tool slugs are env-overridable because the exact slug
// depends on how the toolkit is registered in Composio; the defaults follow
// Composio's TOOLKIT_ACTION convention. The mapper is pure and the fetch path is
// unit tested through the injectable Composio fetch.

import type { ExtractedDataPoint } from "@/lib/earn/browser-operator/types";
import {
  executeComposioTool,
  type ComposioConfig,
  type ComposioExecuteResult,
} from "./client.server";

/** Composio tool slug for Marketstack ticker lookup (env-overridable). */
export const MARKETSTACK_TICKERS_TOOL =
  process.env.MARKETSTACK_TICKERS_TOOL || "MARKETSTACK_GET_TICKERS";
/** Composio tool slug for Marketstack latest EOD price (env-overridable). */
export const MARKETSTACK_EOD_TOOL =
  process.env.MARKETSTACK_EOD_TOOL || "MARKETSTACK_GET_EOD_LATEST";

// Marketstack market data is authoritative for identity/price → high confidence.
const MARKETSTACK_CONFIDENCE = 90;

// ── Marketstack response shapes (only the fields we read) ─────────────────────

interface MarketstackExchange {
  name?: string;
  acronym?: string;
  mic?: string;
}
interface MarketstackTicker {
  name?: string;
  symbol?: string;
  stock_exchange?: MarketstackExchange;
  exchange?: string;
  exchange_acronym?: string;
}
interface MarketstackEod {
  symbol?: string;
  close?: number;
  date?: string;
}

/** The normalized market identity we extract from Marketstack. */
export interface MarketstackCompany {
  name: string;
  symbol: string;
  exchange: string | null;
  latestClose: number | null;
  latestDate: string | null;
}

/**
 * Marketstack wraps rows under `data`, and Composio may wrap the whole response
 * again under `data`. Dig defensively for the first array of rows.
 */
function firstRow<T>(payload: unknown): T | undefined {
  const seen = new Set<unknown>();
  let node: unknown = payload;
  for (let depth = 0; depth < 4 && node && !seen.has(node); depth += 1) {
    seen.add(node);
    if (Array.isArray(node)) return node[0] as T | undefined;
    if (typeof node === "object") {
      const data = (node as { data?: unknown }).data;
      if (Array.isArray(data)) return data[0] as T | undefined;
      node = data;
    } else {
      break;
    }
  }
  return undefined;
}

function exchangeLabel(t: MarketstackTicker | undefined): string | null {
  if (!t) return null;
  const ex = t.stock_exchange;
  const name = ex?.name || t.exchange || null;
  const acronym = ex?.acronym || ex?.mic || t.exchange_acronym || null;
  if (name && acronym && !name.includes(acronym)) return `${name} (${acronym})`;
  return name || acronym || null;
}

/**
 * Resolve a query (ticker or company name) to a Marketstack market identity +
 * latest EOD price, executing both hops through Composio. Returns null when the
 * ticker lookup misses. Never throws — a Composio miss on the price hop just
 * drops the price.
 */
export async function fetchMarketstackCompanyViaComposio(
  config: ComposioConfig,
  query: string,
): Promise<MarketstackCompany | null> {
  const q = query.trim();
  if (!q) return null;

  // 1. Resolve the ticker.
  const tickersRes: ComposioExecuteResult<unknown> = await executeComposioTool(
    config,
    MARKETSTACK_TICKERS_TOOL,
    { search: q, limit: 1 },
  );
  if (!tickersRes.ok) return null;
  const ticker = firstRow<MarketstackTicker>(tickersRes.data);
  if (!ticker?.symbol) return null;

  const symbol = ticker.symbol.trim().toUpperCase();

  // 2. Best-effort latest EOD price (a miss here is non-fatal).
  let latestClose: number | null = null;
  let latestDate: string | null = null;
  const eodRes: ComposioExecuteResult<unknown> = await executeComposioTool(
    config,
    MARKETSTACK_EOD_TOOL,
    { symbols: symbol },
  );
  if (eodRes.ok) {
    const eod = firstRow<MarketstackEod>(eodRes.data);
    if (eod && typeof eod.close === "number") {
      latestClose = eod.close;
      latestDate = eod.date ? eod.date.slice(0, 10) : null;
    }
  }

  return {
    name: ticker.name?.trim() || q,
    symbol,
    exchange: exchangeLabel(ticker),
    latestClose,
    latestDate,
  };
}

/**
 * Map a resolved Marketstack company into `ExtractedDataPoint[]`. Pure — no I/O.
 * Market identity is authoritative (no per-field confirmation); the source URL
 * names Marketstack so provenance is auditable in review.
 */
export function mapMarketstackToDataPoints(company: MarketstackCompany): ExtractedDataPoint[] {
  const capturedAt = new Date().toISOString();
  const sourceUrl = "https://marketstack.com";
  const points: ExtractedDataPoint[] = [];

  const push = (field_name: string, value: string, evidence: string) => {
    if (!value) return;
    points.push({
      field_name,
      extracted_value: value,
      source_type: "edgar",
      source_url: sourceUrl,
      captured_at: capturedAt,
      confidence_score: MARKETSTACK_CONFIDENCE,
      evidence_snippet: evidence,
      requires_user_confirmation: false,
    });
  };

  push("company_name", company.name, `Marketstack market data (${company.symbol})`);
  push("company_ticker", company.symbol, "Marketstack ticker symbol");
  if (company.exchange) push("company_exchange", company.exchange, "Marketstack listing exchange");
  if (company.latestClose !== null) {
    const priced = company.latestDate
      ? `${company.latestClose} (close ${company.latestDate})`
      : String(company.latestClose);
    push("market_price", priced, "Marketstack latest end-of-day close");
  }

  return points;
}
