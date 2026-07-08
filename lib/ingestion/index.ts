// lib/ingestion/index.ts
// Public surface of the compliant web-data ingestion engine. The Source hub and
// its cron/API callers import from here.
//
// Flow:  seeds → CompliantFetcher (robots + rate-limit) → extractEntities
//        (Claude-optional, deterministic fallback) → normalizeEntities → the
//        sourcing-intel catalog (ingestEntities). All native TS, keyless in CI,
//        compliant by construction (public pages / official APIs only).
export { runIngestion, dedupeInputs } from "@/lib/ingestion/pipeline";
export type { IngestSeed, IngestOptions, IngestRunResult, PageOutcome } from "@/lib/ingestion/pipeline";
export { CompliantFetcher } from "@/lib/ingestion/fetcher";
export type { FetcherStrategy, FetchResult, CompliantFetcherOptions } from "@/lib/ingestion/fetcher";
export { extractEntities, heuristicExtract, extractionLive } from "@/lib/ingestion/extract";
export type { ExtractedEntity, ExtractInput } from "@/lib/ingestion/extract";
export { normalizeEntities } from "@/lib/ingestion/normalize";
export { parseRobots, isAllowed, crawlDelayFor } from "@/lib/ingestion/robots";
export type { RobotsPolicy } from "@/lib/ingestion/robots";
