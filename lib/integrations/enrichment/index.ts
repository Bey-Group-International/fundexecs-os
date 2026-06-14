import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { log } from '@/lib/observability/log';
import { meterAction } from '@/lib/credits/meter';
import { mockEnrichmentProvider } from './mock';
import { orthogonalConfigured, orthogonalEnrichmentProvider } from './orthogonal';
import {
  companyCacheKey,
  personCacheKey,
  type CompanyInput,
  type EnrichedCompany,
  type EnrichedPerson,
  type EnrichmentProvider,
  type PersonInput
} from './types';

/* ============================================================================
 * lib/integrations/enrichment/index.ts — the metered, cached enrichment seam.
 *
 * `enrichPerson` / `enrichCompany` pick the active vendor (Orthogonal when a key
 * is set, else the deterministic mock), serve from `provider_cache` when fresh,
 * meter real vendor calls (`enrichment`), persist the result to the cache, and
 * audit to the Chain of Trust. Never-block: any failure degrades to
 * `{ found: false }`. RLS-scoped via the request client.
 * ========================================================================= */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The vendor in force: Orthogonal if configured, otherwise the free mock. */
export function activeEnrichmentProvider(): EnrichmentProvider {
  return orthogonalConfigured() ? orthogonalEnrichmentProvider : mockEnrichmentProvider;
}

export interface EnrichResult<T> {
  data: T;
  provider: string;
  cached: boolean;
}

type Kind = 'person' | 'company';

async function readCache<T>(
  orgId: string,
  provider: string,
  kind: Kind,
  key: string
): Promise<T | null> {
  if (!key) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('provider_cache')
      .select('payload, expires_at')
      .eq('org_id', orgId)
      .eq('provider', provider)
      .eq('kind', kind)
      .eq('cache_key', key)
      .maybeSingle();
    if (!data) return null;
    if (data.expires_at && Date.parse(data.expires_at) < Date.now()) return null;
    return data.payload as T;
  } catch {
    return null;
  }
}

async function writeCache(
  orgId: string,
  provider: string,
  kind: Kind,
  key: string,
  payload: unknown
): Promise<void> {
  if (!key) return;
  try {
    const supabase = await createClient();
    await supabase.from('provider_cache').upsert(
      {
        org_id: orgId,
        provider,
        kind,
        cache_key: key,
        payload: payload as never,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString()
      },
      { onConflict: 'org_id,provider,kind,cache_key' }
    );
  } catch {
    // Caching is best-effort; never block enrichment on a cache write.
  }
}

async function audit(orgId: string, kind: Kind, provider: string, key: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from('trust_events').insert({
      org_id: orgId,
      entity_type: 'enrichment',
      action: 'enrichment_fetched',
      metadata: { kind, provider, cache_key: key }
    });
  } catch {
    // Audit is best-effort.
  }
}

/** Meter a real vendor call. The mock is free. Returns false when balance-gated. */
async function meterIfPaid(orgId: string, provider: string, refId: string): Promise<boolean> {
  if (provider === 'mock') return true;
  const meter = await meterAction(orgId, 'enrichment', refId);
  if (!meter.ok) {
    log.info('enrichment_skipped', { orgId, provider, reason: meter.reason });
    return false;
  }
  return true;
}

export async function enrichPerson(
  orgId: string,
  input: PersonInput
): Promise<EnrichResult<EnrichedPerson>> {
  const provider = activeEnrichmentProvider();
  const key = personCacheKey(input);

  const cached = await readCache<EnrichedPerson>(orgId, provider.id, 'person', key);
  if (cached) return { data: cached, provider: provider.id, cached: true };

  if (!(await meterIfPaid(orgId, provider.id, key))) {
    return { data: { found: false }, provider: provider.id, cached: false };
  }

  const data = await provider.enrichPerson(input);
  if (data.found) {
    await writeCache(orgId, provider.id, 'person', key, data);
    await audit(orgId, 'person', provider.id, key);
  }
  return { data, provider: provider.id, cached: false };
}

export async function enrichCompany(
  orgId: string,
  input: CompanyInput
): Promise<EnrichResult<EnrichedCompany>> {
  const provider = activeEnrichmentProvider();
  const key = companyCacheKey(input);

  const cached = await readCache<EnrichedCompany>(orgId, provider.id, 'company', key);
  if (cached) return { data: cached, provider: provider.id, cached: true };

  if (!(await meterIfPaid(orgId, provider.id, key))) {
    return { data: { found: false }, provider: provider.id, cached: false };
  }

  const data = await provider.enrichCompany(input);
  if (data.found) {
    await writeCache(orgId, provider.id, 'company', key, data);
    await audit(orgId, 'company', provider.id, key);
  }
  return { data, provider: provider.id, cached: false };
}
