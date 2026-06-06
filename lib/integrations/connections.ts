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

interface IntegrationSecretInsert {
  connection_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_type: string | null;
  expires_at: string | null;
  updated_at?: string;
}

interface PrivateResult<T> {
  data: T | null;
  error: unknown;
}

interface PrivateIntegrationSecretsTable {
  select(columns: string): {
    eq(
      column: 'connection_id',
      value: string
    ): {
      maybeSingle(): Promise<PrivateResult<IntegrationSecretRow>>;
    };
  };
  upsert(
    row: IntegrationSecretInsert,
    options: { onConflict: string }
  ): {
    select(columns: string): {
      single(): Promise<PrivateResult<IntegrationSecretRow>>;
    };
  };
}

interface PrivateSchemaClient {
  from(table: 'integration_secrets'): PrivateIntegrationSecretsTable;
}

function privateSchema(admin: Admin): PrivateSchemaClient {
  return (admin as unknown as { schema(schema: 'private'): PrivateSchemaClient }).schema('private');
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
  const { data, error } = await privateSchema(admin)
    .from('integration_secrets')
    .select('connection_id, access_token, refresh_token, token_type, expires_at, updated_at')
    .eq('connection_id', connectionId)
    .maybeSingle();

  if (error) throw error;
  return data;
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
  const row: IntegrationSecretInsert = {
    connection_id: connectionId,
    access_token: accessToken,
    refresh_token: refreshToken === undefined ? (existing?.refresh_token ?? null) : refreshToken,
    token_type: tokenType ?? existing?.token_type ?? null,
    expires_at: expiresAt === undefined ? (existing?.expires_at ?? null) : expiresAt,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await privateSchema(admin)
    .from('integration_secrets')
    .upsert(row, { onConflict: 'connection_id' })
    .select('connection_id, access_token, refresh_token, token_type, expires_at, updated_at')
    .single();

  if (error || !data) throw error ?? new Error('Could not store integration secret');
  return data;
}

export function isSecretExpired(secret: IntegrationSecretRow, graceMs = 5 * 60 * 1000): boolean {
  if (!secret.expires_at) return false;
  return new Date(secret.expires_at).getTime() <= Date.now() + graceMs;
}
