import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runDiligence } from '@/lib/diligence/orchestrator';

/**
 * POST /api/diligence — trigger the 7-agent diligence orchestration for an
 * existing `diligence_runs` row.
 *
 * Body: { runId: string }
 *
 * Authorization: the request is gated to an authenticated user who is a member
 * of the run's org. We verify membership with the user's (RLS-bound) client
 * BEFORE doing any service-role work in the orchestrator. `diligence_runs` has
 * member-SELECT RLS, so a successful read of the run with the user client both
 * confirms the run exists and that the caller may see it.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { runId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  // Membership check via the RLS-bound user client. If the user is not a member
  // of the run's org, RLS returns no row → 404 (don't leak existence).
  const { data: run, error } = await supabase
    .from('diligence_runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'Failed to load run' }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  try {
    const result = await runDiligence(runId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Diligence failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
