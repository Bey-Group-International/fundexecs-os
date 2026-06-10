import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { PROVIDER_META, providerAvailable } from '@/lib/integrations/catalog';
import type { Provider } from '@/lib/integrations/catalog';

/**
 * POST /api/integrations/request-access
 * Body: { provider: string }
 *
 * Records a member's interest in a catalogued-but-not-yet-wired provider so the
 * "Request access" affordance persists across reloads and ops can prioritize
 * wiring by real demand. Idempotent per (org, user, provider).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
  const provider = typeof body?.provider === 'string' ? body.provider : '';

  const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
  if (!meta) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider || '(none)'}` },
      { status: 404 }
    );
  }
  // Only "coming soon" providers take requests; wired ones connect directly.
  if (providerAvailable(provider as Provider)) {
    return NextResponse.json(
      { error: `${meta.name} is already available — connect it directly.` },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Persist under the workspace the member is actually viewing. getActiveOrg
  // honors the active-org cookie (re-validating membership), matching how the
  // integrations UI reads — getFirstOrgId could land the row in a different org
  // for a multi-org member, making the request look "lost".
  const activeOrg = await getActiveOrg();
  if (!activeOrg) {
    return NextResponse.json({ error: 'No organization for user' }, { status: 400 });
  }
  const orgId = activeOrg.orgId;

  const admin = createAdminClient();
  const { error } = await admin.from('integration_access_requests').upsert(
    {
      org_id: orgId,
      user_id: user.id,
      provider,
      status: 'requested',
      updated_at: new Date().toISOString()
    },
    { onConflict: 'org_id,user_id,provider' }
  );

  if (error) {
    return NextResponse.json({ error: 'Could not record request' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, provider });
}
