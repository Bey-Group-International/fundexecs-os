// lib/ingestion/pipeline.ts
// The ingestion pipeline: seed URLs → compliant fetch → structured extract →
// normalize → catalog. This is the backbone the Source hub was missing —
// source-radar/sourcing-signals describe "a real third-party feed plugs in
// behind this seam"; this is that feed, built native and compliant.
//
// The pipeline is org-scoped (rows land under RLS via ingestEntities), bounded
// (a hard page cap), and best-effort end to end: a fetch that robots blocks or
// that fails is recorded in the run summary and skipped, never thrown. The
// fetcher is injectable (FetcherStrategy) so a source can swap backends without
// touching this orchestration; the default is the CompliantFetcher.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { EntityKind, IntelEntityInput } from "@/lib/sourcing-intel";
import { ingestEntities } from "@/lib/sourcing-intel";
import { CompliantFetcher, type FetcherStrategy, type FetchResult } from "@/lib/ingestion/fetcher";
import { extractEntities } from "@/lib/ingestion/extract";
import { normalizeEntities } from "@/lib/ingestion/normalize";

type Client = SupabaseClient<Database>;

export interface IngestSeed {
  url: string;
  /** What kind of entity this page is expected to describe. */
  targetKind: EntityKind;
}

export interface IngestOptions {
  /** Hard cap on pages fetched this run (safety + cost bound). Default 25. */
  maxPages?: number;
  /** Swap the fetch backend; defaults to the CompliantFetcher. */
  fetcher?: FetcherStrategy;
}

// Per-URL outcome, surfaced so the caller can show what happened and why.
export interface PageOutcome {
  url: string;
  ok: boolean;
  extracted: number;
  reason?: FetchResult["reason"];
}

export interface IngestRunResult {
  pagesAttempted: number;
  pagesFetched: number;
  entitiesExtracted: number;
  entitiesIngested: number;
  outcomes: PageOutcome[];
}

/**
 * Run the pipeline over a set of seeds and upsert the normalized entities into
 * the org's sourcing catalog. Returns a run summary. Never throws — every
 * failure mode degrades into a recorded outcome. The catalog write is a single
 * batched, de-duped ingestEntities call at the end.
 */
export async function runIngestion(
  supabase: Client,
  orgId: string,
  userId: string | null,
  seeds: IngestSeed[],
  opts: IngestOptions = {},
): Promise<IngestRunResult> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 25, 100));
  const fetcher = opts.fetcher ?? new CompliantFetcher();
  const targets = seeds.slice(0, maxPages);

  const outcomes: PageOutcome[] = [];
  const collected: IntelEntityInput[] = [];
  let pagesFetched = 0;
  let entitiesExtracted = 0;

  for (const seed of targets) {
    const res = await fetcher.fetch(seed.url);
    if (!res.ok) {
      outcomes.push({ url: seed.url, ok: false, extracted: 0, reason: res.reason });
      continue;
    }
    pagesFetched++;
    const extracted = await extractEntities({ url: seed.url, html: res.html, targetKind: seed.targetKind });
    entitiesExtracted += extracted.length;
    const normalized = normalizeEntities(extracted, { sourceUrl: seed.url });
    collected.push(...normalized);
    outcomes.push({ url: seed.url, ok: true, extracted: normalized.length });
  }

  // De-dupe across pages before the single catalog write.
  const deduped = dedupeInputs(collected);
  const entitiesIngested = deduped.length ? await ingestEntities(supabase, orgId, userId, deduped) : 0;

  return {
    pagesAttempted: targets.length,
    pagesFetched,
    entitiesExtracted,
    entitiesIngested,
    outcomes,
  };
}

// De-dupe catalog inputs by (kind, lower(name)); first occurrence wins. Pure.
export function dedupeInputs(inputs: IntelEntityInput[]): IntelEntityInput[] {
  const seen = new Set<string>();
  const out: IntelEntityInput[] = [];
  for (const e of inputs) {
    const key = `${e.kind}:${e.name.trim().toLowerCase()}`;
    if (!e.name.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
