import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { discoverProviders, type ProviderKind } from '@/lib/ai/partner-discovery';

/* ============================================================================
 * POST /api/partners/discover — LLM-assisted provider discovery for the
 * Partner Marketplace. Auth + org scoped. Returns AI-suggested candidates the
 * operator can vet and adopt. Reports `configured: false` when the AI key is
 * absent so the UI can fall back to manual add.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

const KINDS: readonly (ProviderKind | 'both')[] = ['both', 'service', 'capital'];

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const org = await getActiveOrg().catch(() => null);
  if (!org) return NextResponse.json({ error: 'No active organization' }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    query?: unknown;
    kind?: unknown;
  } | null;
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query)
    return NextResponse.json({ error: 'Enter what you are looking for.' }, { status: 400 });

  const kind = (KINDS as readonly string[]).includes(body?.kind as string)
    ? (body?.kind as ProviderKind | 'both')
    : 'both';

  try {
    const result = await discoverProviders({ query, kind });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
