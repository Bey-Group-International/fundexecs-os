import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteURL } from '@/lib/site-url';
import type { Database } from '@/lib/supabase/database.types';
import { authCookieDomain } from '@/lib/supabase/cookie-domain';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';
import {
  API_KEY_PROVIDERS,
  GOOGLE_PROVIDERS,
  GOOGLE_SCOPE_STRING,
  GOOGLE_SCOPES,
  INTEGRATION_GOOGLE_INTENT_COOKIE,
  OAUTH_PROVIDERS,
  integrationStateCookie,
  integrationVerifierCookie
} from '@/lib/integrations/constants';
import {
  buildOAuthAuthorizationUrl,
  getOAuthProviderConfig,
  makeCodeChallenge,
  makeCodeVerifier,
  makeOAuthState
} from '@/lib/integrations/oauth';
import {
  getFirstOrgId,
  storeIntegrationSecret,
  upsertIntegrationConnection
} from '@/lib/integrations/connections';

const COOKIE_MAX_AGE = 10 * 60;

function secureCookies() {
  return getSiteURL().startsWith('https://');
}

function redirectToIntegrations(request: NextRequest, message: string) {
  const url = new URL('/integrations', request.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const { user } = await requireUser();

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'Sign in before connecting integrations.');
    return NextResponse.redirect(loginUrl);
  }

  if (GOOGLE_PROVIDERS.has(provider)) {
    // signInWithOAuth generates the PKCE code-verifier and persists it via the
    // client's cookie adapter. The shared server client writes to the
    // `next/headers` store, which does NOT reliably attach to a freshly built
    // NextResponse.redirect — so the verifier is lost and `/auth/callback`
    // fails with "PKCE code verifier not found". Capture the cookies it wants
    // to set and apply them to the redirect response we return.
    const cookieStore = await cookies();
    const pending: { name: string; value: string; options: CookieOptions }[] = [];
    const url = supabaseUrl();
    const anonKey = supabaseAnonKey();
    if (!url || !anonKey) {
      return redirectToIntegrations(request, 'Google connect is temporarily unavailable.');
    }
    const oauthClient = createServerClient<Database>(url, anonKey, {
      cookieOptions: { domain: authCookieDomain() },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const cookie of toSet) pending.push(cookie);
        }
      }
    });

    const { data, error } = await oauthClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${getSiteURL()}/auth/callback`,
        scopes: GOOGLE_SCOPE_STRING,
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });

    if (error || !data.url) {
      return redirectToIntegrations(request, error?.message ?? 'Could not start Google OAuth.');
    }

    const response = NextResponse.redirect(data.url);
    for (const cookie of pending) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    response.cookies.set(INTEGRATION_GOOGLE_INTENT_COOKIE, provider, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(),
      path: '/',
      maxAge: COOKIE_MAX_AGE
    });
    return response;
  }

  if (OAUTH_PROVIDERS.has(provider)) {
    const config = getOAuthProviderConfig(provider);
    if (!config) {
      return redirectToIntegrations(request, `Missing ${provider} OAuth environment variables.`);
    }

    const state = makeOAuthState();
    const redirectUri = `${getSiteURL()}/api/integrations/${provider}/callback`;
    const codeVerifier = provider === 'calendly' ? makeCodeVerifier() : undefined;
    const url = buildOAuthAuthorizationUrl({
      config,
      redirectUri,
      state,
      codeChallenge: codeVerifier ? makeCodeChallenge(codeVerifier) : undefined
    });
    const response = NextResponse.redirect(url);
    response.cookies.set(integrationStateCookie(provider), state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(),
      path: '/',
      maxAge: COOKIE_MAX_AGE
    });
    if (codeVerifier) {
      response.cookies.set(integrationVerifierCookie(provider), codeVerifier, {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies(),
        path: '/',
        maxAge: COOKIE_MAX_AGE
      });
    }
    return response;
  }

  if (API_KEY_PROVIDERS.has(provider)) {
    return redirectToIntegrations(request, `${provider} connects with an API key.`);
  }

  return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== 'apollo') {
    return NextResponse.json(
      { error: `POST connect is not supported for ${provider}` },
      { status: 405 }
    );
  }

  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { apiKey?: unknown } | null;
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (apiKey.length < 8) {
    return NextResponse.json({ error: 'Enter a valid Apollo API key.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const orgId = await getFirstOrgId(admin, user.id);
  if (!orgId) {
    return NextResponse.json({ error: 'No organization for user' }, { status: 400 });
  }

  const connection = await upsertIntegrationConnection({
    admin,
    orgId,
    userId: user.id,
    provider,
    externalAccount: 'Apollo API key',
    scopes: ['api_key'],
    metadata: {
      auth_type: 'api_key',
      connected_at: new Date().toISOString()
    }
  });
  await storeIntegrationSecret({
    admin,
    connectionId: connection.id,
    accessToken: apiKey,
    refreshToken: null,
    tokenType: 'api_key',
    expiresAt: null
  });

  return NextResponse.json({ ok: true, provider });
}
