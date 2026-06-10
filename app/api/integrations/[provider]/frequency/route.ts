import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/integrations/registry';
import { getConnectedIntegrationConnection } from '@/lib/integrations/connections';
import { getActiveOrg } from '@/lib/queries/org';
import { isSyncFrequency } from '@/lib/integrations/sync-frequency';

/**
 * POST /api/integrations/:provider/frequency
 * Body: { frequency: 'realtime' | 'hourly' | 'daily' | 'manual' }
 *
 * Persists the sync cadence on the member's connected provider row so the
 * preference is durable and cross-device (it previously lived only in
 * localStorage). Validates against the same set the DB check constraint allows.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await ctx.params;

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { frequency?: unknown } | null;
  if (!isSyncFrequency(body?.frequency)) {
    return NextResponse.json({ error: 'Invalid sync frequency' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Scope the cadence write to the workspace the member is actually viewing.
  // getActiveOrg honors the active-org cookie (re-validating membership), so a
  // multi-org member can't save the preference onto — or get "Connect first"
  // for — the wrong org's connection, which getFirstOrgId risked.
  const activeOrg = await getActiveOrg();
  if (!activeOrg) {
    return NextResponse.json({ error: 'No organization for user' }, { status: 400 });
  }
  const orgId = activeOrg.orgId;

  const admin = createAdminClient();
  const connection = await getConnectedIntegrationConnection({
    admin,
    orgId,
    userId: user.id,
    provider: providerId
  });
  if (!connection) {
    return NextResponse.json({ error: `Connect ${providerId} first` }, { status: 400 });
  }

  const { error } = await admin
    .from('integration_connections')
    .update({ sync_frequency: body.frequency, updated_at: new Date().toISOString() })
    .eq('id', connection.id);

  if (error) {
    return NextResponse.json({ error: 'Could not save frequency' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, provider: providerId, frequency: body.frequency });
}
