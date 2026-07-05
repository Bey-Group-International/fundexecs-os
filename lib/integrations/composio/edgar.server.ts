// Company + EDGAR-filing extraction, redesigned to AVOID the SEC EDGAR API.
//
// Primary path (no SEC API):
//   • Company / market facts  ← Marketstack  (marketstack.server.ts)
//   • EDGAR filing discovery   ← Google web search via Composio (edgar-search.server.ts)
//
// Both emit the identical `ExtractedDataPoint[]` the browser-operator review
// queue understands, so the review → approve → persist pipeline is unchanged.
// The direct SEC JSON path is retained ONLY as a zero-config fallback so the
// feature still returns something in an environment with neither a Composio nor a
// Marketstack key configured — it is no longer the primary source.

import type { ExtractedDataPoint } from "@/lib/earn/browser-operator/types";
import {
  extractFromEdgar,
  type EdgarCompany,
  type ExtractEdgarResult,
} from "@/lib/earn/browser-operator/sources/edgar.server";
import type { HttpFetch } from "@/lib/earn/browser-operator/sources/http";
import { composioConfigForOrg, type ComposioConfig } from "./client.server";
import { searchEdgarFilingsViaGoogle } from "./edgar-search.server";
import {
  fetchMarketstackCompany,
  mapMarketstackToDataPoints,
  resolveMarketstackApiKey,
} from "./marketstack.server";

type FetchLike = typeof fetch;

/** Synthesize the EdgarCompany the ExtractEdgarResult contract carries. */
function companyFromPoints(points: ExtractedDataPoint[], query: string): EdgarCompany {
  const name = points.find((p) => p.field_name === "company_name")?.extracted_value ?? query;
  const ticker = points.find((p) => p.field_name === "company_ticker")?.extracted_value ?? query.toUpperCase();
  return { cik: "", cikPadded: "", ticker, title: name };
}

export interface ExtractEdgarPreferComposioInput {
  query: string;
  limit?: number;
  /** Injected HTTP for the direct SEC fallback (keeps engine tests hermetic). */
  http?: HttpFetch;
}

export interface ExtractEdgarPreferComposioDeps {
  /** Org whose vaulted Composio / Marketstack keys (if any) to use. */
  orgId?: string;
  /** Test seam: a ready ComposioConfig for the Google search; null skips it. */
  composio?: ComposioConfig | null;
  /** Test seam: a Marketstack access key; null skips the Marketstack lookup. */
  marketstackKey?: string | null;
  /** Test seam: injected fetch for the Marketstack REST calls. */
  marketstackFetch?: FetchLike;
}

/**
 * Extract company facts (Marketstack) + EDGAR filings (Google web search via
 * Composio). Runs the two sources concurrently and merges their points. When
 * neither source is configured or both come back empty, falls back to the direct
 * SEC JSON path so the feature never hard-fails.
 */
export async function extractEdgarPreferComposio(
  input: ExtractEdgarPreferComposioInput,
  deps: ExtractEdgarPreferComposioDeps = {},
): Promise<ExtractEdgarResult> {
  const query = input.query?.trim();
  if (!query) return { ok: false, reason: "not_found", message: "An EDGAR ticker or company name is required." };

  const composio =
    deps.composio !== undefined ? deps.composio : await composioConfigForOrg(deps.orgId);
  const marketstackKey =
    deps.marketstackKey !== undefined ? deps.marketstackKey : await resolveMarketstackApiKey(deps.orgId);

  const [factPoints, filingPoints] = await Promise.all([
    // Company / market facts via Marketstack.
    (async (): Promise<ExtractedDataPoint[]> => {
      if (!marketstackKey) return [];
      const company = await fetchMarketstackCompany(marketstackKey, query, { fetchImpl: deps.marketstackFetch });
      return company ? mapMarketstackToDataPoints(company) : [];
    })(),
    // EDGAR filings via Google web search (through Composio).
    (async (): Promise<ExtractedDataPoint[]> => {
      if (!composio) return [];
      return searchEdgarFilingsViaGoogle(composio, query, { limit: input.limit });
    })(),
  ]);

  const points = [...factPoints, ...filingPoints];
  if (points.length > 0) {
    return { ok: true, company: companyFromPoints(points, query), points };
  }

  // Zero-config fallback: neither Marketstack nor Composio produced anything.
  return extractFromEdgar({ query, limit: input.limit, http: input.http });
}
