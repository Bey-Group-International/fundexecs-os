/* ============================================================================
 * lib/integrations/enrichment/types.ts — the provider-agnostic enrichment seam
 * (Phase 2, P2-A).
 *
 * One interface, swappable vendors. An aggregator (Orthogonal) can satisfy it
 * for many underlying sources; direct vendors (People Data Labs, …) implement
 * the same shape. Every provider is NEVER-BLOCK: on a miss, missing key, or
 * error it returns `{ found: false }` rather than throwing, so callers degrade
 * gracefully. Metering, caching, and audit are handled by the `enrich` wrapper
 * (`./index`), not the providers themselves.
 * ========================================================================= */

/** What we know going in when enriching a person. */
export interface PersonInput {
  email?: string;
  fullName?: string;
  company?: string;
  linkedinUrl?: string;
}

/** What we know going in when enriching a company. */
export interface CompanyInput {
  domain?: string;
  name?: string;
}

/** Normalized person result. `raw` carries the provider payload for audit/RAG. */
export interface EnrichedPerson {
  found: boolean;
  fullName?: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  location?: string;
  linkedinUrl?: string;
  emails?: string[];
  phones?: string[];
  raw?: unknown;
}

/** Normalized company result. */
export interface EnrichedCompany {
  found: boolean;
  name?: string;
  domain?: string;
  industry?: string;
  description?: string;
  employeeCount?: number;
  location?: string;
  foundedYear?: number;
  linkedinUrl?: string;
  raw?: unknown;
}

/** A swappable enrichment vendor. Implementations must never throw. */
export interface EnrichmentProvider {
  /** Stable id, also used as the `provider_cache.provider` value. */
  id: string;
  enrichPerson(input: PersonInput): Promise<EnrichedPerson>;
  enrichCompany(input: CompanyInput): Promise<EnrichedCompany>;
}

/** Canonical cache key for a person lookup (lowercased, stable). */
export function personCacheKey(input: PersonInput): string {
  return (
    input.email?.trim().toLowerCase() ||
    input.linkedinUrl?.trim().toLowerCase() ||
    [input.fullName, input.company].filter(Boolean).join('|').trim().toLowerCase()
  );
}

/** Canonical cache key for a company lookup. */
export function companyCacheKey(input: CompanyInput): string {
  return (input.domain || input.name || '').trim().toLowerCase();
}
