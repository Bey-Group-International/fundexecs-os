import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type IntegrationConnectionRow = Database['public']['Tables']['integration_connections']['Row'];

export interface ProviderConnection {
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  external_account: string | null;
  last_synced_at: string | null;
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
    .select('provider, status, external_account, last_synced_at')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error || !data) return [];

  return (
    data as Pick<
      IntegrationConnectionRow,
      'provider' | 'status' | 'external_account' | 'last_synced_at'
    >[]
  ).map((c) => ({
    provider: c.provider,
    status: normalizeStatus(c.status),
    external_account: c.external_account,
    last_synced_at: c.last_synced_at
  }));
}

function normalizeStatus(status: string): ProviderConnection['status'] {
  if (status === 'connected' || status === 'active') return 'connected';
  if (status === 'error' || status === 'needs_attention') return 'error';
  return 'disconnected';
}
