// EDGAR extraction routed through Composio's COMPOSIO_SEARCH_SEC_FILINGS tool,
// with a transparent fallback to the direct SEC JSON path.
//
// Both paths read only authoritative *public* SEC data — no login, no scraping,
// no headless browser — and both emit the identical `ExtractedDataPoint[]` the
// browser-operator review queue already understands, so nothing downstream (the
// review → approve → persist pipeline, the audit trail) changes shape.
//
// Preference order in `extractEdgarPreferComposio`:
//   1. Composio COMPOSIO_SEARCH_SEC_FILINGS  — when a Composio key is configured.
//   2. Direct SEC submissions JSON            — always available, no key needed.
// A Composio failure (unconfigured, throttled, empty) falls back to the direct
// path so EDGAR extraction never regresses by adopting Composio.

import type { ExtractedDataPoint } from "@/lib/earn/browser-operator/types";
import { policyForSource } from "@/lib/earn/browser-operator/source-policy";
import {
  extractFromEdgar,
  type EdgarCompany,
  type ExtractEdgarResult,
} from "@/lib/earn/browser-operator/sources/edgar.server";
import type { HttpFetch } from "@/lib/earn/browser-operator/sources/http";
import {
  composioConfigForOrg,
  executeComposioTool,
  type ComposioConfig,
  type ComposioExecuteResult,
} from "./client.server";

export const COMPOSIO_SEC_FILINGS_TOOL = "COMPOSIO_SEARCH_SEC_FILINGS";

/**
 * One filing as COMPOSIO_SEARCH_SEC_FILINGS reports it. Field names vary by
 * Composio version, so every accessor below is tolerant of common aliases.
 */
interface ComposioFiling {
  form_type?: string;
  form?: string;
  filing_date?: string;
  filed_at?: string;
  date?: string;
  accession_number?: string;
  accession_no?: string;
  primary_document_url?: string;
  primary_document?: string;
  document_url?: string;
  index_url?: string;
  filing_url?: string;
  report_date?: string;
  primary_doc_description?: string;
  description?: string;
}

interface ComposioSecFilingsPayload {
  ticker?: string;
  cik?: string | number;
  company_name?: string;
  name?: string;
  title?: string;
  filings?: ComposioFiling[];
  results?: ComposioFiling[];
}

function str(...vals: Array<unknown>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** Locate the filings array wherever this Composio version placed it. */
function filingsOf(payload: ComposioSecFilingsPayload | null | undefined): ComposioFiling[] {
  if (!payload) return [];
  if (Array.isArray(payload.filings)) return payload.filings;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function padCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  return digits ? digits.padStart(10, "0") : "";
}

/**
 * Map a Composio SEC-filings payload into `ExtractedDataPoint[]` — the same
 * shape the direct SEC path produces. Pure: no I/O, so it is unit tested from a
 * sample payload. EDGAR is authoritative, so points do not require per-field
 * confirmation (mirrors mapSubmissionsToDataPoints).
 */
export function mapComposioSecFilingsToDataPoints(
  payload: ComposioSecFilingsPayload | null | undefined,
  opts: { query: string; limit?: number },
): ExtractedDataPoint[] {
  const filings = filingsOf(payload);
  const limit = opts.limit ?? 10;
  const capturedAt = new Date().toISOString();
  const confidence = policyForSource("edgar").base_confidence;

  const cikRaw = str(payload?.cik);
  const cikPadded = padCik(cikRaw);
  const name = str(payload?.company_name, payload?.name, payload?.title);
  const ticker = str(payload?.ticker);
  const indexUrl = cikPadded
    ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikPadded}&type=&dateb=&owner=include&count=40`
    : "https://www.sec.gov/cgi-bin/browse-edgar";

  const points: ExtractedDataPoint[] = [];
  const push = (
    field_name: string,
    value: string,
    source_url: string,
    evidence?: string,
  ) => {
    if (!value) return;
    points.push({
      field_name,
      extracted_value: value,
      source_type: "edgar",
      source_url,
      captured_at: capturedAt,
      confidence_score: confidence,
      evidence_snippet: evidence,
      requires_user_confirmation: false,
    });
  };

  push("company_name", name, indexUrl, ticker ? `SEC registrant (${ticker})` : "SEC registrant name");
  push("company_cik", cikPadded, indexUrl, cikPadded ? `Central Index Key ${cikPadded}` : undefined);

  const n = Math.min(limit, filings.length);
  for (let i = 0; i < n; i += 1) {
    const f = filings[i];
    const form = str(f.form_type, f.form);
    const date = str(f.filing_date, f.filed_at, f.date);
    const accession = str(f.accession_number, f.accession_no);
    if (!form && !accession) continue;
    const docUrl =
      str(f.primary_document_url, f.document_url, f.filing_url, f.index_url, f.primary_document) ||
      indexUrl;
    const value = [form, date, accession].filter(Boolean).join(" · ");
    push(`filing_${i + 1}`, value, docUrl, str(f.primary_doc_description, f.description) || `${form} filed ${date}`);
  }

  return points;
}

/** Synthesize the EdgarCompany the ExtractEdgarResult contract carries. */
function companyFromPayload(payload: ComposioSecFilingsPayload | null | undefined, query: string): EdgarCompany {
  const cikRaw = str(payload?.cik);
  const cikPadded = padCik(cikRaw);
  return {
    cik: cikRaw.replace(/\D/g, "").replace(/^0+/, "") || cikRaw || "",
    cikPadded,
    ticker: str(payload?.ticker) || query.toUpperCase(),
    title: str(payload?.company_name, payload?.name, payload?.title) || query,
  };
}

export interface ExtractEdgarViaComposioInput {
  query: string;
  limit?: number;
  /** Optional explicit form-type filter passed straight to Composio. */
  formTypes?: string[];
}

/**
 * Run EDGAR extraction through Composio. Executes COMPOSIO_SEARCH_SEC_FILINGS
 * and maps the result. Returns the same discriminated result the direct path
 * uses, so callers can treat the two interchangeably.
 */
export async function extractEdgarViaComposio(
  config: ComposioConfig,
  input: ExtractEdgarViaComposioInput,
): Promise<ExtractEdgarResult> {
  const query = input.query?.trim();
  if (!query) return { ok: false, reason: "not_found", message: "An EDGAR ticker or company name is required." };

  const args: Record<string, unknown> = {
    ticker_or_cik: query,
    limit: input.limit ?? 10,
    include_document_links: true,
  };
  if (input.formTypes?.length) args.form_types = input.formTypes;

  const res: ComposioExecuteResult<ComposioSecFilingsPayload> = await executeComposioTool(
    config,
    COMPOSIO_SEC_FILINGS_TOOL,
    args,
  );
  if (!res.ok) return { ok: false, reason: "fetch_failed", message: res.error };

  const points = mapComposioSecFilingsToDataPoints(res.data, { query, limit: input.limit });
  // A 200 with an empty/not-found payload is a real Composio pitfall — treat a
  // payload with no filing points as "not found" so the fallback can take over.
  const hasFilings = points.some((p) => p.field_name.startsWith("filing_"));
  if (!hasFilings) {
    return { ok: false, reason: "not_found", message: `No SEC filings matched "${query}" via Composio.` };
  }

  return { ok: true, company: companyFromPayload(res.data, query), points };
}

export interface ExtractEdgarPreferComposioInput {
  query: string;
  limit?: number;
  /** Injected HTTP for the direct SEC fallback (keeps engine tests hermetic). */
  http?: HttpFetch;
}

export interface ExtractEdgarPreferComposioDeps {
  /** Org whose vaulted Composio key (if any) to use. */
  orgId?: string;
  /** Test seam: a ready ComposioConfig; when provided, skips key resolution. */
  composio?: ComposioConfig | null;
}

/**
 * EDGAR extraction preferring Composio, falling back to the direct SEC JSON API.
 * When Composio is unconfigured or its lookup fails/empties, the direct path
 * runs so EDGAR extraction is never worse for having adopted Composio.
 */
export async function extractEdgarPreferComposio(
  input: ExtractEdgarPreferComposioInput,
  deps: ExtractEdgarPreferComposioDeps = {},
): Promise<ExtractEdgarResult> {
  const config =
    deps.composio !== undefined ? deps.composio : await composioConfigForOrg(deps.orgId);

  if (config) {
    const viaComposio = await extractEdgarViaComposio(config, { query: input.query, limit: input.limit });
    if (viaComposio.ok) return viaComposio;
    // fall through to the direct SEC path on any Composio miss.
  }

  return extractFromEdgar({ query: input.query, limit: input.limit, http: input.http });
}
