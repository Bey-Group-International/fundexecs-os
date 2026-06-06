import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  GOOGLE_PROVIDER_IDS,
  GOOGLE_PROVIDERS,
  GOOGLE_SCOPES,
  INTEGRATION_GOOGLE_INTENT_COOKIE
} from '@/lib/integrations/constants';
import {
  getFirstOrgId,
  storeIntegrationSecret,
  upsertIntegrationConnection
} from '@/lib/integrations/connections';

type GooglePersistResult =
  | { attempted: false }
  | { attempted: true; ok: true }
  | { attempted: true; ok: false; error: string };

async function persistGoogleIntegration(request: NextRequest) {
  const provider = request.cookies.get(INTEGRATION_GOOGLE_INTENT_COOKIE)?.value;
  if (!provider || !GOOGLE_PROVIDERS.has(provider)) return { attempted: false } as const;

  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.provider_token || !session.user) {
    return {
      attempted: true,
      ok: false,
      error: 'Google did not return an access token. Reconnect the integration.'
    } as const;
  }

  const admin = createAdminClient();
  const orgId = await getFirstOrgId(admin, session.user.id);
  if (!orgId) {
    return { attempted: true, ok: false, error: 'No organization for user.' } as const;
  }

  const externalAccount = session.user.email ?? 'Google account';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (const googleProvider of GOOGLE_PROVIDER_IDS) {
    const connection = await upsertIntegrationConnection({
      admin,
      orgId,
      userId: session.user.id,
      provider: googleProvider,
      externalAccount,
      scopes: GOOGLE_SCOPES,
      metadata: {
        auth_type: 'oauth',
        connected_via: provider,
        google_user_id: session.user.id
      }
    });
    await storeIntegrationSecret({
      admin,
      connectionId: connection.id,
      accessToken: session.provider_token,
      refreshToken: session.provider_refresh_token ?? undefined,
      tokenType: 'bearer',
      expiresAt
    });
  }

  return { attempted: true, ok: true } as const;
}

function integrationRedirect(origin: string, result: GooglePersistResult, fallback: string) {
  if (!result.attempted) return `${origin}${fallback}`;
  if (result.ok) return `${origin}/integrations?connected=google`;
  return `${origin}/integrations?error=${encodeURIComponent(result.error)}`;
}

/**
 * Exchanges the auth code (from email confirmation / OAuth) for a session
 * and redirects the user into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Only allow same-origin relative paths to avoid open-redirects.
  const requestedNext = searchParams.get('next');
  const next =
    requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/command-center';

  // TEMP diagnostic — host + which auth cookies reach the exchange. Remove once
  // the verifier-loss root cause is confirmed.
  {
    const names = request.cookies.getAll().map((c) => c.name);
    console.error(
      '[auth/callback:diag2]',
      JSON.stringify({
        host: request.headers.get('host'),
        origin,
        hasCode: !!code,
        verifierCookies: names.filter((n) => n.includes('code-verifier') || n.includes('verifier')),
        sbCookies: names.filter((n) => n.startsWith('sb-')),
        intent: request.cookies.get(INTEGRATION_GOOGLE_INTENT_COOKIE)?.value ?? null
      })
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback:diag2] exchange error:', error.message);
    }
    if (!error) {
      const integrationResult = await persistGoogleIntegration(request).catch((err) => ({
        attempted: true as const,
        ok: false as const,
        error: err instanceof Error ? err.message : 'Could not persist Google integration.'
      }));
      if (integrationResult.attempted && !integrationResult.ok) {
        // Surface the real persist failure for ops; the user sees a friendly message.
        console.error('[auth/callback] integration persist failed:', integrationResult.error);
      }
      const response = NextResponse.redirect(integrationRedirect(origin, integrationResult, next));
      response.cookies.delete(INTEGRATION_GOOGLE_INTENT_COOKIE);
      return response;
    }
    // TEMP: surface the cookie/host context in the redirect URL so it can be
    // captured from a paste (runtime-log table truncates it). Remove after RCA.
    const diag = [
      `host=${request.headers.get('host')}`,
      `supabaseUrl=${process.env.NEXT_PUBLIC_SUPABASE_URL}`,
      `cookies=${request.cookies
        .getAll()
        .map((c) => c.name)
        .join('|')}`
    ].join(';;');
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}&d=${encodeURIComponent(diag)}`
    );
  }

  // Pass through any provider error (e.g. flow_state_already_used) to /login.
  const oauthError = searchParams.get('error_description') || searchParams.get('error');
  const suffix = oauthError ? `?error=${encodeURIComponent(oauthError)}` : '';
  return NextResponse.redirect(`${origin}/login${suffix}`);
}
