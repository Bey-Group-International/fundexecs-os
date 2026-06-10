import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type IntegrationConnectionRow = Database['public']['Tables']['integration_connections']['Row'];

export interface ProviderConnection {
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  external_account: string | null;
  last_synced_at: string | null;
  sync_frequency: string | null;
}

/**
 * Fetch the user's integration_connections for the org. RLS-scoped via the
 * server client; query errors degrade to an empty array. Merging with the
 * static provider catalog is done in the page so callers always render the
 * full set of known providers.
 */
export async function getIntegrationConnections(
  orgId: string,
  userId: string
): Promise<ProviderConnection[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('integration_connections')
    .select('provider, status, external_account, last_synced_at, sync_frequency')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error || !data) return [];

  return (
    data as Pick<
      IntegrationConnectionRow,
      'provider' | 'status' | 'external_account' | 'last_synced_at' | 'sync_frequency'
    >[]
  ).map((c) => ({
    provider: c.provider,
    status: normalizeStatus(c.status),
    external_account: c.external_account,
    last_synced_at: c.last_synced_at,
    sync_frequency: c.sync_frequency
  }));
}

function normalizeStatus(status: string): ProviderConnection['status'] {
  if (status === 'connected' || status === 'active') return 'connected';
  if (status === 'error' || status === 'needs_attention') return 'error';
  return 'disconnected';
}

/**
 * Provider keys the member has already requested early access for (the
 * catalogued-but-not-yet-wired "coming soon" providers). RLS-scoped via the
 * server client; query errors degrade to an empty array so the cards still
 * render their default "Request access" affordance.
 */
export async function getIntegrationAccessRequests(
  orgId: string,
  userId: string
): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('integration_access_requests')
    .select('provider')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error || !data) return [];

  return (data as { provider: string }[]).map((r) => r.provider);
}
