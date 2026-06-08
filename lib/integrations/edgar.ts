import 'server-only';

/* ============================================================================
 * lib/integrations/edgar.ts — SEC EDGAR Form D ingestion source.
 *
 * Pulls the most recent Form D (exempt private-offering) filings from EDGAR's
 * public "current filings" Atom feed. Form D = a fund or company just raised
 * private capital → the highest-signal, free, real-time intel for FundExecs.
 *
 * No SDK, no XML dependency: the feed is small and regular, so we parse the
 * handful of fields we need with scoped regexes. SEC requires a descriptive
 * User-Agent with contact info on every request (set EDGAR_USER_AGENT); we
 * fall back to a generic one so a missing env never hard-fails ingestion.
 * ========================================================================= */

const EDGAR_CURRENT_FEED =
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&company=&dateb=&owner=include&output=atom';

const DEFAULT_USER_AGENT = 'FundExecs OS intelligence ingestion (ops@fundexecs.com)';
const FETCH_TIMEOUT_MS = 10_000;

export interface FormDFiling {
  /** EDGAR accession number — the natural de-dupe key. */
  accession: string;
  formType: string;
  issuerName: string;
  filingHref: string | null;
  /** ISO timestamp the filing was published. */
  occurredAt: string | null;
}

/**
 * Decode the handful of XML entities the feed uses. `&amp;` is unescaped LAST
 * so a doubly-encoded entity like `&amp;lt;` decodes to the literal `&lt;`
 * rather than being double-unescaped into `<`.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/**
 * Parse the title EDGAR uses for a current filing, e.g.
 *   "D - ACME CAPITAL FUND LP (0001234567) (Filer)"
 *   "D/A - Some Issuer, Inc. (0009876543) (Filer)"
 * into { formType, issuerName }.
 */
function parseTitle(title: string): { formType: string; issuerName: string } {
  const dash = title.indexOf(' - ');
  if (dash === -1) return { formType: 'D', issuerName: title };
  const formType = title.slice(0, dash).trim() || 'D';
  let rest = title.slice(dash + 3).trim();
  // Strip the trailing "(CIK) (Filer)" suffix.
  rest = rest.replace(/\s*\(\d{4,}\)\s*\([^)]*\)\s*$/, '').replace(/\s*\(\d{4,}\)\s*$/, '');
  return { formType, issuerName: rest.trim() || title };
}

function parseEntry(block: string): FormDFiling | null {
  const id = tag(block, 'id') ?? '';
  const accMatch = id.match(/accession-?number=([0-9-]+)/i);
  const accession = accMatch ? accMatch[1] : '';
  if (!accession) return null;

  const title = tag(block, 'title') ?? '';
  const { formType, issuerName } = parseTitle(title);

  const hrefMatch = block.match(/<link[^>]*href="([^"]+)"/i);
  const filingHref = hrefMatch ? decodeEntities(hrefMatch[1]) : null;

  const updated = tag(block, 'updated');
  const occurredAt = updated ? new Date(updated).toISOString() : null;

  return { accession, formType, issuerName, filingHref, occurredAt };
}

/**
 * Fetch the most recent Form D filings. Returns `[]` (never throws) on network
 * error, timeout, or non-200 so the ingestion pipeline degrades gracefully.
 */
export async function fetchRecentFormD(limit = 100): Promise<FormDFiling[]> {
  const url = `${EDGAR_CURRENT_FEED}&count=${Math.max(1, Math.min(100, limit))}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': process.env.EDGAR_USER_AGENT || DEFAULT_USER_AGENT,
        Accept: 'application/atom+xml'
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const out: FormDFiling[] = [];
    const seen = new Set<string>();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];
    for (const block of entries) {
      const filing = parseEntry(block);
      if (filing && !seen.has(filing.accession)) {
        seen.add(filing.accession);
        out.push(filing);
      }
    }
    return out;
  } catch {
    return [];
  }
}
