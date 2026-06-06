import 'server-only';

import { createHash, randomBytes } from 'crypto';
import type { Json } from '@/lib/supabase/database.types';
import { GOOGLE_PROVIDERS } from './constants';
import type { IntegrationSecretRow } from './connections';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const CALENDLY_AUTH_URL = 'https://auth.calendly.com/oauth/authorize';
const CALENDLY_TOKEN_URL = 'https://auth.calendly.com/oauth/token';

interface OAuthProviderConfig {
  provider: 'slack' | 'calendly';
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export interface ExchangedProviderToken {
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
  scopes: string[];
  externalAccount: string;
  metadata: Json;
}

function resolveServerEnv(suffix: string): string | undefined {
  const exact = process.env[suffix];
  if (exact) return exact;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

function splitScopes(value: string | undefined, fallback: string[]): string[] {
  return (value ?? fallback.join(' '))
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getOAuthProviderConfig(provider: string): OAuthProviderConfig | null {
  if (provider === 'slack') {
    const clientId = resolveServerEnv('SLACK_CLIENT_ID');
    const clientSecret = resolveServerEnv('SLACK_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      scopes: splitScopes(process.env.SLACK_USER_SCOPES, [
        'im:read',
        'im:history',
        'users:read',
        'users:read.email'
      ])
    };
  }

  if (provider === 'calendly') {
    const clientId = resolveServerEnv('CALENDLY_CLIENT_ID');
    const clientSecret = resolveServerEnv('CALENDLY_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      scopes: splitScopes(process.env.CALENDLY_SCOPES, ['users:read', 'scheduled_events:read'])
    };
  }

  return null;
}

export function makeOAuthState(): string {
  return randomBytes(24).toString('base64url');
}

export function makeCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

export function makeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildOAuthAuthorizationUrl({
  config,
  redirectUri,
  state,
  codeChallenge
}: {
  config: OAuthProviderConfig;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  if (config.provider === 'slack') {
    const params = new URLSearchParams({
      client_id: config.clientId,
      user_scope: config.scopes.join(','),
      redirect_uri: redirectUri,
      state
    });
    return `${SLACK_AUTH_URL}?${params}`;
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state
  });
  if (codeChallenge) {
    params.set('code_challenge_method', 'S256');
    params.set('code_challenge', codeChallenge);
  }
  return `${CALENDLY_AUTH_URL}?${params}`;
}

export async function exchangeProviderOAuthCode({
  provider,
  code,
  redirectUri,
  codeVerifier
}: {
  provider: 'slack' | 'calendly';
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<ExchangedProviderToken> {
  const config = getOAuthProviderConfig(provider);
  if (!config) {
    throw new Error(`Missing ${provider} OAuth client configuration`);
  }

  if (provider === 'slack') {
    return exchangeSlackCode(config, code, redirectUri);
  }
  return exchangeCalendlyCode(config, code, redirectUri, codeVerifier);
}

async function exchangeSlackCode(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string
): Promise<ExchangedProviderToken> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri
  });
  const res = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    token_type?: string;
    scope?: string;
    app_id?: string;
    team?: { id?: string; name?: string };
    authed_user?: {
      id?: string;
      access_token?: string;
      token_type?: string;
      scope?: string;
    };
  };

  if (!res.ok || !json.ok) {
    throw new Error(`Slack OAuth error: ${json.error ?? res.statusText}`);
  }

  const accessToken = json.authed_user?.access_token ?? json.access_token;
  if (!accessToken) throw new Error('Slack OAuth did not return an access token');
  const scopes = splitScopes(json.authed_user?.scope ?? json.scope, config.scopes);
  const team = json.team?.name && json.team.id ? `${json.team.name} (${json.team.id})` : null;

  return {
    accessToken,
    tokenType: json.authed_user?.token_type ?? json.token_type ?? 'bearer',
    scopes,
    externalAccount: team ?? json.team?.id ?? json.authed_user?.id ?? 'Slack workspace',
    metadata: {
      auth_type: 'oauth',
      team_id: json.team?.id ?? null,
      team_name: json.team?.name ?? null,
      authed_user_id: json.authed_user?.id ?? null,
      app_id: json.app_id ?? null
    }
  };
}

async function exchangeCalendlyCode(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string | undefined
): Promise<ExchangedProviderToken> {
  if (!codeVerifier) throw new Error('Missing Calendly PKCE verifier');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier
  });
  const res = await fetch(CALENDLY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
        'base64'
      )}`
    },
    body
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
    message?: string;
    title?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(`Calendly OAuth error: ${json.message ?? json.title ?? res.statusText}`);
  }

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${json.access_token}` }
  });
  const me = (await meRes.json().catch(() => null)) as {
    resource?: { uri?: string; email?: string; name?: string };
  } | null;
  const user = meRes.ok ? me?.resource : null;

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    tokenType: json.token_type ?? 'bearer',
    expiresAt:
      typeof json.expires_in === 'number'
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : null,
    scopes: splitScopes(json.scope, config.scopes),
    externalAccount: user?.email ?? user?.uri ?? 'Calendly account',
    metadata: {
      auth_type: 'oauth',
      user_uri: user?.uri ?? null,
      user_email: user?.email ?? null,
      user_name: user?.name ?? null
    }
  };
}

export async function refreshProviderToken({
  provider,
  secret
}: {
  provider: string;
  secret: IntegrationSecretRow;
}): Promise<{
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
} | null> {
  if (!secret.refresh_token) return null;

  if (GOOGLE_PROVIDERS.has(provider)) {
    const clientId = resolveServerEnv('GOOGLE_CLIENT_ID');
    const clientSecret = resolveServerEnv('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: secret.refresh_token,
      client_id: clientId,
      client_secret: clientSecret
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(
        `Google token refresh failed: ${json.error_description ?? json.error ?? res.statusText}`
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: secret.refresh_token,
      tokenType: json.token_type ?? secret.token_type,
      expiresAt:
        typeof json.expires_in === 'number'
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : null
    };
  }

  if (provider === 'calendly') {
    const config = getOAuthProviderConfig('calendly');
    if (!config) return null;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: secret.refresh_token
    });
    const res = await fetch(CALENDLY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
          'base64'
        )}`
      },
      body
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      message?: string;
      title?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(
        `Calendly token refresh failed: ${json.message ?? json.title ?? res.statusText}`
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? secret.refresh_token,
      tokenType: json.token_type ?? secret.token_type,
      expiresAt:
        typeof json.expires_in === 'number'
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : null
    };
  }

  return null;
}
