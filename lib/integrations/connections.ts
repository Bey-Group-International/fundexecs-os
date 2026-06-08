import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';

type Admin = SupabaseClient<Database>;
type ConnectionRow = Pick<
  Database['public']['Tables']['integration_connections']['Row'],
  'id' | 'external_account' | 'last_synced_at' | 'provider' | 'scopes' | 'status'
>;

export interface IntegrationSecretRow {
  connection_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_type: string | null;
  expires_at: string | null;
  updated_at: string;
}

/**
 * private.integration_secrets is not exposed to the REST API. Read/write it
 * through the service_role-only SECURITY DEFINER functions in the public schema
 * (migration 20260606180000). These RPCs aren't in the generated types yet, so
 * call them through a narrow structural cast.
 */
interface SecretRpcClient {
  rpc(
    fn: 'get_integration_secret',
    args: { _connection_id: string }
  ): Promise<{ data: IntegrationSecretRow[] | null; error: unknown }>;
  rpc(
    fn: 'store_integration_secret',
    args: {
      _connection_id: string;
      _access_token: string;
      _refresh_token: string | null;
      _token_type: string | null;
      _expires_at: string | null;
    }
  ): Promise<{ data: unknown; error: unknown }>;
}

function secretRpc(admin: Admin): SecretRpcClient {
  return admin as unknown as SecretRpcClient;
}

export async function getFirstOrgId(admin: Admin, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.org_id ?? null;
}

export async function upsertIntegrationConnection({
  admin,
  orgId,
  userId,
  provider,
  externalAccount,
  scopes,
  metadata,
  status = 'connected'
}: {
  admin: Admin;
  orgId: string;
  userId: string;
  provider: string;
  externalAccount: string;
  scopes?: readonly string[];
  metadata?: Json;
  status?: string;
}): Promise<ConnectionRow> {
  const { data, error } = await admin
    .from('integration_connections')
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        provider,
        external_account: externalAccount,
        status,
        scopes: [...(scopes ?? [])],
        metadata: metadata ?? {}
      },
      { onConflict: 'org_id,user_id,provider,external_account' }
    )
    .select('id, external_account, last_synced_at, provider, scopes, status')
    .single();

  if (error || !data) throw error ?? new Error('Could not record integration connection');
  return data;
}

export async function getConnectedIntegrationConnection({
  admin,
  orgId,
  userId,
  provider
}: {
  admin: Admin;
  orgId: string;
  userId: string;
  provider: string;
}): Promise<ConnectionRow | null> {
  const { data, error } = await admin
    .from('integration_connections')
    .select('id, external_account, last_synced_at, provider, scopes, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getIntegrationSecret(
  admin: Admin,
  connectionId: string
): Promise<IntegrationSecretRow | null> {
  const { data, error } = await secretRpc(admin).rpc('get_integration_secret', {
    _connection_id: connectionId
  });

  if (error) throw error;
  return data?.[0] ?? null;
}

export async function storeIntegrationSecret({
  admin,
  connectionId,
  accessToken,
  refreshToken,
  tokenType,
  expiresAt
}: {
  admin: Admin;
  connectionId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
}): Promise<IntegrationSecretRow> {
  const existing = await getIntegrationSecret(admin, connectionId);
  const resolved = {
    connection_id: connectionId,
    access_token: accessToken,
    refresh_token: refreshToken === undefined ? (existing?.refresh_token ?? null) : refreshToken,
    token_type: tokenType ?? existing?.token_type ?? null,
    expires_at: expiresAt === undefined ? (existing?.expires_at ?? null) : expiresAt
  };

  const { error } = await secretRpc(admin).rpc('store_integration_secret', {
    _connection_id: resolved.connection_id,
    _access_token: resolved.access_token,
    _refresh_token: resolved.refresh_token,
    _token_type: resolved.token_type,
    _expires_at: resolved.expires_at
  });

  if (error) throw error;
  return { ...resolved, updated_at: new Date().toISOString() };
}

export function isSecretExpired(secret: IntegrationSecretRow, graceMs = 5 * 60 * 1000): boolean {
  if (!secret.expires_at) return false;
  return new Date(secret.expires_at).getTime() <= Date.now() + graceMs;
}

/**
 * Disconnect a provider for a user/org: flip every matching connection row to
 * 'disconnected' and blank its stored access token so it can no longer sync.
 * Reconnecting re-runs the normal OAuth/API-key flow. Returns how many
 * connection rows were affected (0 = nothing was connected).
 */
export async function disconnectIntegration({
  admin,
  orgId,
  userId,
  provider
}: {
  admin: Admin;
  orgId: string;
  userId: string;
  provider: string;
}): Promise<number> {
  const { data: rows, error: selectError } = await admin
    .from('integration_connections')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('provider', provider);

  if (selectError) throw selectError;
  if (!rows || rows.length === 0) return 0;

  const { error: updateError } = await admin
    .from('integration_connections')
    .update({ status: 'disconnected' })
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('provider', provider);

  if (updateError) throw updateError;

  // Blank the private token(s) so a stale secret can't be reused before the
  // row is reconnected. The secret RPC upserts by connection id.
  await Promise.all(
    rows.map((row) =>
      storeIntegrationSecret({
        admin,
        connectionId: row.id,
        accessToken: '',
        refreshToken: null,
        tokenType: null,
        expiresAt: null
      }).catch(() => undefined)
    )
  );

  return rows.length;
}
