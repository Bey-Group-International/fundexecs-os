import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteURL } from '@/lib/site-url';
import {
  OAUTH_PROVIDERS,
  integrationStateCookie,
  integrationVerifierCookie
} from '@/lib/integrations/constants';
import { exchangeProviderOAuthCode } from '@/lib/integrations/oauth';
import {
  getFirstOrgId,
  storeIntegrationSecret,
  upsertIntegrationConnection
} from '@/lib/integrations/connections';

function integrationRedirect(
  request: NextRequest,
  provider: string,
  params: Record<string, string>
) {
  const url = new URL('/integrations', request.url);
  url.searchParams.set('provider', provider);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!OAUTH_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `Unknown OAuth provider: ${provider}` }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const expectedState = request.cookies.get(integrationStateCookie(provider))?.value;
  const codeVerifier = request.cookies.get(integrationVerifierCookie(provider))?.value;

  if (!code) {
    return integrationRedirect(request, provider, {
      error: searchParams.get('error_description') ?? searchParams.get('error') ?? 'OAuth failed.'
    });
  }
  if (!expectedState || expectedState !== returnedState) {
    return integrationRedirect(request, provider, { error: 'OAuth state mismatch.' });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'Sign in before connecting integrations.');
    return NextResponse.redirect(loginUrl);
  }

  try {
    const admin = createAdminClient();
    const orgId = await getFirstOrgId(admin, user.id);
    if (!orgId) throw new Error('No organization for user');

    const redirectUri = `${getSiteURL()}/api/integrations/${provider}/callback`;
    const token = await exchangeProviderOAuthCode({
      provider: provider as 'slack' | 'calendly' | 'zoom',
      code,
      redirectUri,
      codeVerifier
    });
    const connection = await upsertIntegrationConnection({
      admin,
      orgId,
      userId: user.id,
      provider,
      externalAccount: token.externalAccount,
      scopes: token.scopes,
      metadata: token.metadata
    });
    await storeIntegrationSecret({
      admin,
      connectionId: connection.id,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt
    });

    const response = integrationRedirect(request, provider, { connected: '1' });
    response.cookies.delete(integrationStateCookie(provider));
    response.cookies.delete(integrationVerifierCookie(provider));
    return response;
  } catch (err) {
    const response = integrationRedirect(request, provider, {
      error: err instanceof Error ? err.message : 'OAuth callback failed.'
    });
    response.cookies.delete(integrationStateCookie(provider));
    response.cookies.delete(integrationVerifierCookie(provider));
    return response;
  }
}
