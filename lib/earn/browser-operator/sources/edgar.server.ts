// lib/earn/browser-operator/sources/edgar.server.ts
//
// REAL, compliant, browser-FREE extraction from SEC EDGAR via its public JSON
// APIs — no login, no scraping, no headless browser. Two hops:
//
//   1. company_tickers.json  — resolve a ticker or company name → CIK.
//   2. submissions/CIK##########.json — recent filings + company facts.
//
// SEC requires a descriptive User-Agent on every request; we send one on ALL
// calls (see SEC_USER_AGENT). The HTTP layer is injectable so this maps sample
// payloads to `ExtractedDataPoint[]` in unit tests with zero network access.

import type { ExtractedDataPoint } from "../types";
import { policyForSource } from "../source-policy";
import { defaultHttpFetch, type HttpFetch } from "./http";

/** SEC's fair-access policy REQUIRES a descriptive UA identifying the caller. */
export const SEC_USER_AGENT = "FundExecs OS research (contact: support@fundexecs.com)";

const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

/** One entry in company_tickers.json (keyed by an arbitrary numeric string). */
interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

/** The subset of submissions/CIK##########.json we read. */
interface SubmissionsPayload {
  cik?: string;
  name?: string;
  sic?: string;
  sicDescription?: string;
  tickers?: string[];
  addresses?: {
    business?: EdgarAddress;
    mailing?: EdgarAddress;
  };
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

interface EdgarAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  stateOrCountry?: string | null;
  zipCode?: string | null;
}

export interface EdgarCompany {
  cik: string;
  cikPadded: string;
  ticker: string;
  title: string;
}

const SEC_HEADERS: Record<string, string> = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
};

/** Zero-pad a CIK to the 10-digit form the submissions endpoint expects. */
export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

/**
 * Resolve a ticker or company-name query against company_tickers.json. An exact
 * ticker match wins; otherwise the first case-insensitive name substring match.
 */
export async function resolveCompany(
  query: string,
  http: HttpFetch = defaultHttpFetch,
): Promise<EdgarCompany | null> {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const res = await http(COMPANY_TICKERS_URL, { headers: SEC_HEADERS });
  if (!res.ok) return null;
  const raw = (JSON.parse(await res.text()) ?? {}) as Record<string, TickerEntry>;
  const entries = Object.values(raw);

  const byTicker = entries.find((e) => e.ticker?.toLowerCase() === needle);
  const match =
    byTicker ??
    entries.find((e) => e.title?.toLowerCase().includes(needle)) ??
    null;
  if (!match) return null;

  const cik = String(match.cik_str);
  return { cik, cikPadded: padCik(cik), ticker: match.ticker, title: match.title };
}

/** Fetch the raw submissions payload for a resolved company. */
export async function fetchSubmissions(
  cikPadded: string,
  http: HttpFetch = defaultHttpFetch,
): Promise<SubmissionsPayload | null> {
  const res = await http(`${SUBMISSIONS_BASE}/CIK${cikPadded}.json`, { headers: SEC_HEADERS });
  if (!res.ok) return null;
  return JSON.parse(await res.text()) as SubmissionsPayload;
}

/** Build the canonical public URL for a filing's primary document. */
export function primaryDocUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const cikInt = String(cik).replace(/\D/g, "").replace(/^0+/, "") || "0";
  const accNoDashes = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${primaryDocument}`;
}

function fmtAddress(a?: EdgarAddress): string | null {
  if (!a) return null;
  const parts = [a.street1, a.street2, a.city, a.stateOrCountry, a.zipCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Map a resolved company + its submissions into `ExtractedDataPoint[]`: company
 * facts (name, CIK, industry/SIC, address) plus the most recent filings. Pure —
 * no I/O — so it is trivially testable from a sample payload.
 */
export function mapSubmissionsToDataPoints(
  company: EdgarCompany,
  payload: SubmissionsPayload,
  limit = 10,
): ExtractedDataPoint[] {
  const capturedAt = new Date().toISOString();
  const confidence = policyForSource("edgar").base_confidence; // 95 — authoritative public source.
  const filingIndexUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cikPadded}&type=&dateb=&owner=include&count=40`;

  const points: ExtractedDataPoint[] = [];

  const push = (
    field_name: string,
    extracted_value: string | null | undefined,
    source_url: string,
    evidence_snippet?: string,
  ) => {
    if (!extracted_value) return;
    points.push({
      field_name,
      extracted_value,
      source_type: "edgar",
      source_url,
      captured_at: capturedAt,
      confidence_score: confidence,
      evidence_snippet,
      // EDGAR is an authoritative public source — no per-field confirmation gate.
      requires_user_confirmation: false,
    });
  };

  const name = payload.name ?? company.title;
  push("company_name", name, filingIndexUrl, `SEC registrant name for CIK ${company.cikPadded}`);
  push("company_cik", company.cikPadded, filingIndexUrl, `Central Index Key ${company.cikPadded}`);
  const industry = payload.sicDescription
    ? `${payload.sicDescription}${payload.sic ? ` (SIC ${payload.sic})` : ""}`
    : payload.sic
      ? `SIC ${payload.sic}`
      : null;
  push("company_industry", industry, filingIndexUrl, payload.sicDescription ?? undefined);
  push("company_address", fmtAddress(payload.addresses?.business), filingIndexUrl, "Business address on file with the SEC");

  const recent = payload.filings?.recent;
  if (recent?.accessionNumber?.length) {
    const n = Math.min(limit, recent.accessionNumber.length);
    for (let i = 0; i < n; i += 1) {
      const form = recent.form?.[i] ?? "";
      const date = recent.filingDate?.[i] ?? "";
      const accession = recent.accessionNumber?.[i] ?? "";
      const doc = recent.primaryDocument?.[i] ?? "";
      if (!form || !accession) continue;
      const docUrl = doc ? primaryDocUrl(company.cik, accession, doc) : filingIndexUrl;
      // Structured, delimiter-encoded so the approval step can rebuild columns.
      const value = `${form} · ${date} · ${accession}`;
      push(
        `filing_${i + 1}`,
        value,
        docUrl,
        recent.primaryDocDescription?.[i] || `${form} filed ${date}`,
      );
    }
  }

  return points;
}

export interface ExtractEdgarInput {
  /** A ticker (e.g. "AAPL") or company-name query (e.g. "Apple"). */
  query: string;
  limit?: number;
  http?: HttpFetch;
}

export type ExtractEdgarResult =
  | { ok: true; company: EdgarCompany; points: ExtractedDataPoint[] }
  | { ok: false; reason: "not_found" | "fetch_failed"; message: string };

/**
 * The end-to-end EDGAR extraction: resolve → fetch submissions → map. Every SEC
 * call carries the required User-Agent. Injectable `http` keeps it testable.
 */
export async function extractFromEdgar(input: ExtractEdgarInput): Promise<ExtractEdgarResult> {
  const http = input.http ?? defaultHttpFetch;
  const query = input.query?.trim();
  if (!query) return { ok: false, reason: "not_found", message: "An EDGAR ticker or company name is required." };

  const company = await resolveCompany(query, http);
  if (!company) {
    return { ok: false, reason: "not_found", message: `No SEC registrant matched "${query}".` };
  }

  const submissions = await fetchSubmissions(company.cikPadded, http);
  if (!submissions) {
    return { ok: false, reason: "fetch_failed", message: `Could not load SEC submissions for CIK ${company.cikPadded}.` };
  }

  return { ok: true, company, points: mapSubmissionsToDataPoints(company, submissions, input.limit) };
}
