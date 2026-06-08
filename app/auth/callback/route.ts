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
import { recordPeerReferral, REFERRAL_COOKIE } from '@/lib/queries/referral-capture';

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

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Capture a peer referral (best-effort, first-touch) from the /r/<code>
      // cookie now that the session exists. record_referral resolves the new
      // user's own org, is idempotent, and skips self / same-org.
      const refCode = request.cookies.get(REFERRAL_COOKIE)?.value;
      if (refCode) {
        const {
          data: { user }
        } = await supabase.auth.getUser();
        if (user) await recordPeerReferral(user.id, refCode);
      }

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
      response.cookies.delete(REFERRAL_COOKIE);
      return response;
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Pass through any provider error (e.g. flow_state_already_used) to /login.
  const oauthError = searchParams.get('error_description') || searchParams.get('error');
  const suffix = oauthError ? `?error=${encodeURIComponent(oauthError)}` : '';
  return NextResponse.redirect(`${origin}/login${suffix}`);
}
