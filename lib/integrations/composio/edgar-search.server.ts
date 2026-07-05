// EDGAR filing DISCOVERY via Google web search (through Composio), replacing the
// SEC filings API. We ask Composio's web-search tool for the company's SEC
// filings scoped to sec.gov, then map the returned citations into `filing_*`
// `ExtractedDataPoint`s pointing at the real filing URLs on sec.gov.
//
// Because these are search-derived pointers (not an authoritative API pull), each
// filing point is moderate-confidence and ALWAYS requires the operator to confirm
// before it is saved — the review-before-save gate does the rest.

import type { ExtractedDataPoint } from "@/lib/earn/browser-operator/types";
import {
  executeComposioTool,
  type ComposioConfig,
  type ComposioExecuteResult,
} from "./client.server";

/** Composio web-search tool slug (Google-style web search). */
export const COMPOSIO_WEB_SEARCH_TOOL = "COMPOSIO_SEARCH_WEB";
// Search-derived filings are corroboration-grade until confirmed.
const SEARCH_FILING_CONFIDENCE = 60;

/** A single web-search result, tolerant of citation vs organic_result shapes. */
interface WebSearchCitation {
  url?: string;
  link?: string;
  title?: string;
  snippet?: string;
  text?: string;
}
interface WebSearchPayload {
  results?: {
    citations?: WebSearchCitation[];
    organic_results?: WebSearchCitation[];
  };
  citations?: WebSearchCitation[];
  organic_results?: WebSearchCitation[];
}

const FORM_RE =
  /\b(10-K\/A|10-Q\/A|10-K|10-Q|8-K|S-1|S-3|S-4|DEF 14A|20-F|40-F|6-K|424B\d?|SC 13[DG]|13F|11-K)\b/i;
const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/;

/** Build the sec.gov-scoped EDGAR search query for a company. */
export function buildEdgarSearchQuery(query: string): string {
  return `${query.trim()} SEC EDGAR filing (10-K OR 10-Q OR 8-K) site:sec.gov`;
}

function citationsOf(payload: WebSearchPayload | null | undefined): WebSearchCitation[] {
  if (!payload) return [];
  return (
    payload.results?.citations ??
    payload.results?.organic_results ??
    payload.citations ??
    payload.organic_results ??
    []
  );
}

function isSecUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "sec.gov" || host.endsWith(".sec.gov");
  } catch {
    return false;
  }
}

/**
 * Map web-search citations into EDGAR `filing_*` data points. Keeps only sec.gov
 * results, dedupes by URL, infers the form type + a filing date when present in
 * the title/snippet. Pure — no I/O. Every point requires user confirmation.
 */
export function mapWebSearchToEdgarFilings(
  payload: WebSearchPayload | null | undefined,
  opts: { limit?: number } = {},
): ExtractedDataPoint[] {
  const limit = opts.limit ?? 10;
  const capturedAt = new Date().toISOString();
  const seen = new Set<string>();
  const points: ExtractedDataPoint[] = [];

  for (const c of citationsOf(payload)) {
    if (points.length >= limit) break;
    const url = (c.url ?? c.link ?? "").trim();
    if (!url || seen.has(url) || !isSecUrl(url)) continue;
    seen.add(url);

    const text = `${c.title ?? ""} ${c.snippet ?? c.text ?? ""}`;
    const form = text.match(FORM_RE)?.[1]?.toUpperCase() ?? "SEC filing";
    const date = text.match(DATE_RE)?.[1] ?? "";
    // "FORM · DATE · ACCESSION" — persist-records splits on "·"; accession is
    // unknown from search, so it is left blank.
    const value = `${form} · ${date} · `;

    points.push({
      field_name: `filing_${points.length + 1}`,
      extracted_value: value,
      source_type: "edgar",
      source_url: url,
      captured_at: capturedAt,
      confidence_score: SEARCH_FILING_CONFIDENCE,
      evidence_snippet: (c.title ?? c.snippet ?? c.text ?? "").trim() || "Google/EDGAR search result",
      requires_user_confirmation: true,
    });
  }

  return points;
}

/**
 * Search EDGAR filings for a company via Composio's web-search tool and map the
 * results. Returns [] on any Composio miss so the caller can decide how to
 * proceed. Never throws.
 */
export async function searchEdgarFilingsViaGoogle(
  config: ComposioConfig,
  query: string,
  opts: { limit?: number } = {},
): Promise<ExtractedDataPoint[]> {
  const q = query.trim();
  if (!q) return [];

  const res: ComposioExecuteResult<WebSearchPayload> = await executeComposioTool(
    config,
    COMPOSIO_WEB_SEARCH_TOOL,
    { query: buildEdgarSearchQuery(q) },
  );
  if (!res.ok) return [];
  return mapWebSearchToEdgarFilings(res.data, opts);
}
