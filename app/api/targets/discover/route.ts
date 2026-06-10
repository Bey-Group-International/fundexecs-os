import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { meterAction } from '@/lib/credits/meter';
import { discoverTargets } from '@/lib/ai/target-discovery';

/* ============================================================================
 * POST /api/targets/discover — LLM-assisted target discovery for the Source
 * verb's Target Scout panel. Auth + org scoped. Returns AI-proposed acquisition
 * or investment targets scored against the supplied mandate. Reports
 * `configured:false` when the AI key is absent. Meters `target_discovery`
 * (fail-open on infra miss, fail-closed on insufficient balance → 402).
 * ========================================================================= */

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const org = await getActiveOrg().catch(() => null);
  if (!org) return NextResponse.json({ error: 'No active organization' }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query)
    return NextResponse.json({ error: 'Describe your fund mandate or thesis.' }, { status: 400 });

  // Meter before the LLM call — fail-open on infra, fail-closed on insufficient.
  const meter = await meterAction(org.orgId, 'target_discovery');
  if (!meter.ok && meter.reason === 'insufficient') {
    return NextResponse.json(
      { error: 'Insufficient credits.', upgradeTo: meter.upgradeTo },
      { status: 402 }
    );
  }

  try {
    const result = await discoverTargets({ query });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Target discovery failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
