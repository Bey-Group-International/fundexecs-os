import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/integrations/registry';
import { getConnectedIntegrationConnection, getFirstOrgId } from '@/lib/integrations/connections';

const ALLOWED_FREQUENCIES = ['realtime', 'hourly', 'daily', 'manual'] as const;
type Frequency = (typeof ALLOWED_FREQUENCIES)[number];

function isFrequency(value: unknown): value is Frequency {
  return typeof value === 'string' && (ALLOWED_FREQUENCIES as readonly string[]).includes(value);
}

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
  if (!isFrequency(body?.frequency)) {
    return NextResponse.json({ error: 'Invalid sync frequency' }, { status: 400 });
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

  const { error } = await admin
    .from('integration_connections')
    .update({ sync_frequency: body.frequency, updated_at: new Date().toISOString() })
    .eq('id', connection.id);

  if (error) {
    return NextResponse.json({ error: 'Could not save frequency' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, provider: providerId, frequency: body.frequency });
}
