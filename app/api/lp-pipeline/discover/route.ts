import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { discoverLps } from '@/lib/ai/lp-discovery';

/* ============================================================================
 * POST /api/lp-pipeline/discover — LLM-assisted LP discovery for the LP
 * Pipeline. Auth + org scoped. Returns AI-suggested LP candidates the operator
 * can vet and add. Reports `configured:false` when the AI key is absent.
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
  if (!query) return NextResponse.json({ error: 'Describe your raise thesis.' }, { status: 400 });

  try {
    const result = await discoverLps({ query });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
