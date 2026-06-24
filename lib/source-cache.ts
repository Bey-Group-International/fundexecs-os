// lib/source-cache.ts
// TTL-based result caching via Supabase source_query_cache table.
// Prevents redundant API calls and enforces data freshness windows per module type.

import { createServerClient } from '@/lib/supabase/server';
import type { VerifiedResult } from './source-hub-types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHash } = require('crypto') as typeof import('crypto');

export const TTL_SECONDS: Record<string, number> = {
  people: 86400,    // 24h — contact data is stable
  company: 43200,   // 12h — company data changes slowly
  investor: 86400,  // 24h — investor data is stable
  signals: 3600,    // 1h — signals refresh frequently
  news: 900,        // 15min — news is near real-time
  default: 21600,   // 6h fallback
};

export function hashQuery(params: Record<string, unknown>): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))
  );
  return createHash('sha256').update(sorted).digest('hex').slice(0, 32);
}

export async function getCached<T>(
  orgId: string,
  module: string,
  provider: string,
  params: Record<string, unknown>
): Promise<VerifiedResult<T> | null> {
  try {
    const supabase = createServerClient();
    const hash = hashQuery(params);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('source_query_cache')
      .select('result, verified, confidence, created_at, expires_at')
      .eq('org_id', orgId)
      .eq('query_hash', hash)
      .eq('module', module)
      .eq('provider', provider)
      .gt('expires_at', now)
      .single();

    if (error || !data) return null;

    const result = data.result as VerifiedResult<T>;
    result.cache = {
      cached: true,
      cache_hit: true,
      cached_at: data.created_at,
      ttl_seconds: TTL_SECONDS[module] ?? TTL_SECONDS.default,
      expires_at: data.expires_at,
    };
    return result;
  } catch {
    return null;
  }
}

export async function setCached<T>(
  orgId: string,
  module: string,
  provider: string,
  params: Record<string, unknown>,
  result: VerifiedResult<T>,
  ttlSeconds?: number
): Promise<void> {
  try {
    const supabase = createServerClient();
    const hash = hashQuery(params);
    const ttl = ttlSeconds ?? TTL_SECONDS[module] ?? TTL_SECONDS.default;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    await supabase.from('source_query_cache').upsert(
      {
        org_id: orgId,
        query_hash: hash,
        module,
        provider,
        result: result as unknown as Record<string, unknown>,
        verified: result.verified,
        confidence: result.confidence,
        expires_at: expiresAt,
      },
      { onConflict: 'org_id,query_hash,module,provider' }
    );
  } catch {
    // Cache write failure is non-fatal
  }
}

// Invalidate cache entries for a module (e.g. after manual data update)
export async function invalidateCache(
  orgId: string,
  module: string,
  provider?: string
): Promise<void> {
  try {
    const supabase = createServerClient();
    let query = supabase
      .from('source_query_cache')
      .delete()
      .eq('org_id', orgId)
      .eq('module', module);

    if (provider) query = query.eq('provider', provider);

    await query;
  } catch {
    // Non-fatal
  }
}
