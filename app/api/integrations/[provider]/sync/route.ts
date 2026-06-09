import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/integrations/registry';
import { ingestSignals } from '@/lib/integrations/ingest';
import {
  getConnectedIntegrationConnection,
  getFirstOrgId,
  getIntegrationSecret,
  isSecretExpired,
  storeIntegrationSecret
} from '@/lib/integrations/connections';
import { refreshProviderToken } from '@/lib/integrations/oauth';
import { asPaidIntegration, PAID_INTEGRATION_ACTION } from '@/lib/credits/costs';
import { meterIntegration } from '@/lib/credits/meter';

/**
 * POST /api/integrations/:provider/sync
 * Pulls fresh signals from a connected provider into contacts/interactions.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await ctx.params;

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const admin = createAdminClient();
  const orgId = await getFirstOrgId(admin, user.id);
  if (!orgId) {
    return NextResponse.json({ error: 'No organization for user' }, { status: 400 });
  }

  const connection = await getConnectedIntegrationConnection({
    admin,
    orgId,
    userId: user.id,
    provider: providerId
  });
  if (!connection) {
    return NextResponse.json({ error: `Connect ${providerId} first` }, { status: 400 });
  }

  let secret = await getIntegrationSecret(admin, connection.id);
  if (!secret?.access_token) {
    return NextResponse.json(
      { error: `Reconnect ${providerId}; no private token is stored.` },
      { status: 400 }
    );
  }

  if (isSecretExpired(secret)) {
    const refreshed = await refreshProviderToken({ provider: providerId, secret });
    if (!refreshed) {
      return NextResponse.json(
        { error: `Reconnect ${providerId}; the stored token has expired.` },
        { status: 400 }
      );
    }
    secret = await storeIntegrationSecret({
      admin,
      connectionId: connection.id,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      tokenType: refreshed.tokenType,
      expiresAt: refreshed.expiresAt
    });
  }
  const accessToken = secret.access_token;
  if (!accessToken) {
    return NextResponse.json(
      { error: `Reconnect ${providerId}; no private token is stored.` },
      { status: 400 }
    );
  }

  // Paid integrations (Apollo, etc.) cost real money per call — gate by plan and
  // debit Earn credits before hitting the vendor. Owned/free providers (Gmail,
  // Calendar, …) aren't in PAID_INTEGRATIONS and skip metering entirely.
  const paid = asPaidIntegration(providerId);
  if (paid) {
    const meter = await meterIntegration(orgId, paid, PAID_INTEGRATION_ACTION[paid], connection.id);
    if (!meter.ok) {
      const upgrade = meter.upgradeTo ?? 'a higher plan';
      const status = meter.reason === 'gated' ? 403 : 402;
      const error =
        meter.reason === 'gated'
          ? `${providerId} isn't available on the ${meter.plan} plan — upgrade to ${upgrade} to use it.`
          : `Out of Earn credits to sync ${providerId} — top up or upgrade to ${upgrade}.`;
      return NextResponse.json(
        { error, reason: meter.reason, upgradeTo: meter.upgradeTo },
        { status }
      );
    }
  }

  try {
    const signals = await provider.fetchSignals({
      token: accessToken,
      since: connection.last_synced_at ?? undefined,
      userEmail: user.email ?? undefined
    });
    const result = await ingestSignals(
      admin,
      { orgId, userId: user.id, connectionId: connection.id, provider: providerId },
      signals
    );

    await admin
      .from('integration_connections')
      .update({ last_synced_at: new Date().toISOString(), status: 'connected' })
      .eq('id', connection.id);

    return NextResponse.json({ ok: true, provider: providerId, ...result });
  } catch (err) {
    await admin.from('integration_connections').update({ status: 'error' }).eq('id', connection.id);
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
