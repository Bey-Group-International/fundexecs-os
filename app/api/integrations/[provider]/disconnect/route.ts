import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { disconnectIntegration, getFirstOrgId } from '@/lib/integrations/connections';

/**
 * POST /api/integrations/:provider/disconnect
 * Disconnects a provider for the signed-in user's org: flips its connection
 * row(s) to 'disconnected' and clears the stored token. Reconnecting re-runs
 * the normal connect flow.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;

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

  try {
    const removed = await disconnectIntegration({ admin, orgId, userId: user.id, provider });
    return NextResponse.json({ ok: true, provider, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Disconnect failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
