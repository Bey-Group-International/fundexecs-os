// lib/ingestion/enrich.ts
// The bridge that finally puts the ingestion + sentiment engines to work on a
// real user action: "enrich this entity from the web." Given a catalog entity
// with a domain, it fetches the site ONCE (compliant fetcher) and does two
// things with that single page:
//
//   1. refresh the catalog entity — extract → normalize (the ingestion engine),
//      so the entity's description/categories reflect what the site actually says.
//   2. read the coverage tone — pull the page's headings/title/meta and score
//      them (the sentiment engine), producing a `news` signal for the Source
//      radar.
//
// The fetch/extract paths are best-effort and the fetcher is injectable, so the
// orchestration is unit-testable with a stub (no network), and `extractHeadlines`
// is pure. The heavy lifting all lives in modules that already exist — this is
// the wiring that makes them produce results.
import { CompliantFetcher, type FetcherStrategy } from "@/lib/ingestion/fetcher";
import { extractEntities, extractTitle, extractMetaDescription, stripHtml } from "@/lib/ingestion/extract";
import { normalizeEntities } from "@/lib/ingestion/normalize";
import { buildNewsSignal } from "@/lib/market-sentiment";
import type { EntityKind, IntelEntityInput } from "@/lib/sourcing-intel";
import type { EntitySignalInput } from "@/lib/sourcing-signals";

// Reduce a domain or URL to a bare registrable host (no scheme, no path). Pure.
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * Pull the page's salient one-liners — <title>, meta description, and the h1/h2
 * headings — as pseudo-headlines for sentiment scoring. De-duped, capped. Pure.
 */
export function extractHeadlines(html: string): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    const t = (s ?? "").trim();
    if (t) out.push(t);
  };
  push(extractTitle(html));
  push(extractMetaDescription(html));
  // End tag tolerates whitespace before ">" (e.g. "</h1 >") so a crafted tag
  // can't slip its body through — the CodeQL bad-tag-filter-safe form.
  const re = /<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) push(stripHtml(m[2]));

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const h of out) {
    const k = h.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(h);
    }
  }
  return deduped.slice(0, 12);
}

export interface EnrichInput {
  subjectName: string;
  entityId?: string | null;
  kind: EntityKind;
  domain: string;
  /** Injectable fetch backend; defaults to the compliant fetcher. */
  fetcher?: FetcherStrategy;
}

export interface EnrichResult {
  ok: boolean;
  /** Why enrichment produced nothing, when !ok. */
  reason?: string;
  sourceUrl?: string;
  /** Refreshed catalog input for the entity (from ingestion extract+normalize). */
  entity?: IntelEntityInput;
  /** Sentiment-derived news signal, when the coverage had a directional tone. */
  newsSignal?: EntitySignalInput;
}

/**
 * Enrich one entity from its website. Fetches the homepage once, then derives a
 * refreshed catalog record and a news-sentiment signal from that page. Never
 * throws — a blocked/failed fetch returns a reasoned, empty result.
 */
export async function enrichFromWeb(input: EnrichInput): Promise<EnrichResult> {
  const domain = normalizeDomain(input.domain);
  if (!domain) return { ok: false, reason: "no_domain" };

  const url = `https://${domain}`;
  const fetcher = input.fetcher ?? new CompliantFetcher();
  const res = await fetcher.fetch(url);
  if (!res.ok) return { ok: false, reason: res.reason ?? "fetch_failed", sourceUrl: url };

  // 1. Refresh the catalog entity (ingestion engine).
  let entity: IntelEntityInput | undefined;
  try {
    const extracted = await extractEntities({ url, html: res.html, targetKind: input.kind });
    entity = normalizeEntities(extracted, { sourceUrl: url, provenance: "web_enrich" })[0];
  } catch {
    // Extraction is best-effort; the news signal below may still land.
  }

  // 2. Read coverage tone (sentiment engine) → news signal.
  const headlines = extractHeadlines(res.html);
  const newsSignal =
    buildNewsSignal(
      { entityId: input.entityId ?? null, subjectName: input.subjectName, kind: input.kind },
      headlines,
      { sourceUrl: url },
    ) ?? undefined;

  return { ok: true, sourceUrl: url, entity, newsSignal };
}
