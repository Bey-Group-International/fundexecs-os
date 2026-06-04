import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProvider, googleProviders } from '@/lib/integrations/registry';
import { ingestSignals } from '@/lib/integrations/ingest';

/**
 * POST /api/integrations/:provider/sync
 * Pulls fresh signals from a connected provider into `interactions` (which
 * auto-updates relationship warmth), upserting contacts along the way.
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

  // Resolve the user's organization (first membership for now).
  const { data: membership } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: 'No organization for user' }, { status: 400 });
  }
  const orgId = membership.org_id;

  // Token resolution is pluggable per provider:
  //  - Google providers (gmail, google_calendar) reuse the OAuth
  //    `provider_token` minted into the user's Supabase session.
  //  - Every other provider (Calendly, Slack, Apollo, Outlook) has its own
  //    OAuth app / API key, so its access token is read (via the admin client)
  //    from the stored connection's `metadata.access_token`. No new table or
  //    migration is introduced — we reuse the existing `metadata` jsonb column.
  let token: string | null = null;
  if (googleProviders.has(providerId)) {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    token = session?.provider_token ?? null;
    if (!token) {
      return NextResponse.json(
        { error: `No provider token for ${providerId}. Reconnect the integration.` },
        { status: 400 }
      );
    }
  } else {
    const { data: stored } = await admin
      .from('integration_connections')
      .select('metadata')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .eq('provider', providerId)
      .limit(1)
      .maybeSingle();
    const metadata = (stored?.metadata ?? null) as { access_token?: unknown } | null;
    token = metadata && typeof metadata.access_token === 'string' ? metadata.access_token : null;
    if (!token) {
      return NextResponse.json(
        { error: `Connect ${providerId} first (no stored token)` },
        { status: 400 }
      );
    }
  }

  // Ensure a connection row exists and read its last sync watermark.
  const { data: connection, error: connError } = await admin
    .from('integration_connections')
    .upsert(
      {
        org_id: orgId,
        user_id: user.id,
        provider: providerId,
        external_account: user.email ?? null,
        status: 'connected'
      },
      { onConflict: 'org_id,user_id,provider,external_account' }
    )
    .select('id, last_synced_at')
    .single();
  if (connError || !connection) {
    return NextResponse.json({ error: 'Could not record connection' }, { status: 500 });
  }

  try {
    const signals = await provider.fetchSignals({
      token,
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
