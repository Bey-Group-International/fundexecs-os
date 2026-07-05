// Company / market facts via the Marketstack API (https://marketstack.com).
//
// This replaces the SEC company-facts lookup: given a ticker or company name we
// resolve the registrant's market identity (name, symbol, exchange) and its
// latest end-of-day price from Marketstack, then emit the same
// `ExtractedDataPoint[]` shape the review queue already understands. The EDGAR
// *filings* themselves are discovered separately via Google web search
// (edgar-search.server.ts) — Marketstack supplies market data, not filings.
//
// Key handling mirrors the Composio layer: the Marketstack access key is resolved
// per-org from the vault (provider `marketstack`) falling back to a process-level
// `MARKETSTACK_API_KEY`. With no key configured, `marketstackConfigured()` is
// false and callers degrade cleanly. The fetch layer is injectable so the mapper
// and the fetch path are unit tested with sample payloads and zero network.

import { getOrgSecret } from "@/lib/org-secrets";
import type { ExtractedDataPoint } from "@/lib/earn/browser-operator/types";

type FetchLike = typeof fetch;

/** Env var holding the process-level Marketstack access key. */
export const MARKETSTACK_API_KEY_ENV = "MARKETSTACK_API_KEY";
/** Env var overriding the Marketstack base URL (v1 vs v2 / http vs https). */
export const MARKETSTACK_BASE_URL_ENV = "MARKETSTACK_BASE_URL";
/** org_secrets.provider key for a per-org Marketstack access key. */
export const MARKETSTACK_SECRET_KEY = "marketstack";

const DEFAULT_BASE_URL = "https://api.marketstack.com/v1";
const DEFAULT_TIMEOUT_MS = 12_000;
// Marketstack market data is authoritative for identity/price → high confidence.
const MARKETSTACK_CONFIDENCE = 90;

/** True when a process-level Marketstack key is configured. */
export function marketstackConfigured(): boolean {
  return Boolean(process.env[MARKETSTACK_API_KEY_ENV]);
}

/**
 * Resolve the Marketstack key for an org: a vaulted per-org key wins over the
 * process-level env key. Returns null when neither is present.
 */
export async function resolveMarketstackApiKey(orgId?: string): Promise<string | null> {
  if (orgId) {
    try {
      const scoped = await getOrgSecret(orgId, MARKETSTACK_SECRET_KEY);
      if (scoped) return scoped;
    } catch {
      // A vault miss/decrypt error must not block the env-key fallback.
    }
  }
  return process.env[MARKETSTACK_API_KEY_ENV] ?? null;
}

function baseUrl(): string {
  return process.env[MARKETSTACK_BASE_URL_ENV] || DEFAULT_BASE_URL;
}

// ── Marketstack response shapes (only the fields we read) ─────────────────────

interface MarketstackExchange {
  name?: string;
  acronym?: string;
  mic?: string;
  country?: string;
  city?: string;
}
interface MarketstackTicker {
  name?: string;
  symbol?: string;
  stock_exchange?: MarketstackExchange;
  // v2 flattens the exchange onto the ticker in some responses.
  exchange?: string;
  exchange_acronym?: string;
}
interface MarketstackTickersResponse {
  data?: MarketstackTicker[];
}
interface MarketstackEod {
  symbol?: string;
  close?: number;
  date?: string;
  exchange?: string;
}
interface MarketstackEodResponse {
  data?: MarketstackEod[];
}

/** The normalized market identity we extract from Marketstack. */
export interface MarketstackCompany {
  name: string;
  symbol: string;
  exchange: string | null;
  latestClose: number | null;
  latestDate: string | null;
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
 * latest EOD price. Two hops: `/tickers?search=` then `/eod/latest?symbols=`.
 * Returns null when the key is missing or nothing matched. Never throws.
 */
export async function fetchMarketstackCompany(
  apiKey: string,
  query: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<MarketstackCompany | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = query.trim();
  if (!apiKey || !q) return null;

  const withTimeout = (): { signal?: AbortSignal; done: () => void } => {
    if (typeof AbortController !== "function") return { done: () => {} };
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return { signal: c.signal, done: () => clearTimeout(t) };
  };

  // 1. Resolve the ticker.
  let ticker: MarketstackTicker | undefined;
  {
    const guard = withTimeout();
    try {
      const url = `${baseUrl()}/tickers?access_key=${encodeURIComponent(apiKey)}&search=${encodeURIComponent(q)}&limit=1`;
      const res = await fetchImpl(url, { signal: guard.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as MarketstackTickersResponse;
      ticker = body.data?.[0];
    } catch {
      return null;
    } finally {
      guard.done();
    }
  }
  if (!ticker?.symbol) return null;

  // 2. Best-effort latest EOD price (a miss here is non-fatal).
  let close: number | null = null;
  let date: string | null = null;
  {
    const guard = withTimeout();
    try {
      const url = `${baseUrl()}/eod/latest?access_key=${encodeURIComponent(apiKey)}&symbols=${encodeURIComponent(ticker.symbol)}`;
      const res = await fetchImpl(url, { signal: guard.signal });
      if (res.ok) {
        const body = (await res.json()) as MarketstackEodResponse;
        const eod = body.data?.[0];
        if (eod && typeof eod.close === "number") {
          close = eod.close;
          date = eod.date ?? null;
        }
      }
    } catch {
      // ignore — price is enrichment, not required.
    } finally {
      guard.done();
    }
  }

  return {
    name: ticker.name?.trim() || q,
    symbol: ticker.symbol.trim().toUpperCase(),
    exchange: exchangeLabel(ticker),
    latestClose: close,
    latestDate: date ? date.slice(0, 10) : null,
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
