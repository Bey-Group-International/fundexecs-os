import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { startWorkflow } from '@/lib/workflows/engine';
import type { WorkflowStepSpec } from '@/lib/workflows/types';

/**
 * POST /api/workflows — start a new XP-gated Earn workflow.
 *
 * Body:
 *   kind  string          — short machine kind, e.g. 'lp_outreach'
 *   steps WorkflowStepSpec[] — ordered steps (title + specialistSlug)
 *
 * Responses:
 *   201 { workflowId }          — created
 *   400 { error }               — invalid input
 *   401                         — not authenticated
 *   403 { error }               — no active org
 *   423 { reason:'locked', requiredLevel, currentLevel }
 *                               — XP gate not met (Level 3 = 400 XP)
 *   500 { error }               — database / infra error
 */
export async function POST(req: NextRequest) {
  // — Auth -------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // — Active org -------------------------------------------------------------
  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: 'No active organization.' }, { status: 403 });
  }

  // — Parse body -------------------------------------------------------------
  let body: { kind?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  if (!kind) {
    return NextResponse.json({ error: '"kind" is required.' }, { status: 400 });
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json({ error: '"steps" must be a non-empty array.' }, { status: 400 });
  }

  // Validate step shape (coarse check; engine validates slugs precisely).
  const steps: WorkflowStepSpec[] = [];
  for (const [i, raw] of (body.steps as unknown[]).entries()) {
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: `Step ${i + 1} must be an object.` }, { status: 400 });
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.title !== 'string' || !s.title.trim()) {
      return NextResponse.json({ error: `Step ${i + 1} is missing "title".` }, { status: 400 });
    }
    if (typeof s.specialistSlug !== 'string' || !s.specialistSlug.trim()) {
      return NextResponse.json(
        { error: `Step ${i + 1} is missing "specialistSlug".` },
        { status: 400 }
      );
    }
    steps.push({ title: s.title.trim(), specialistSlug: s.specialistSlug.trim() });
  }

  // — Engine -----------------------------------------------------------------
  const result = await startWorkflow({
    orgId: org.orgId,
    userId: user.id,
    kind,
    steps
  });

  if (result.ok) {
    return NextResponse.json({ workflowId: result.workflowId }, { status: 201 });
  }

  switch (result.reason) {
    case 'locked':
      // 423 Locked — the caller is below the required XP level.
      return NextResponse.json(
        {
          reason: 'locked',
          requiredLevel: result.requiredLevel,
          currentLevel: result.currentLevel
        },
        { status: 423 }
      );
    case 'invalid_input':
      return NextResponse.json({ error: result.message }, { status: 400 });
    case 'db_error':
      return NextResponse.json({ error: result.message }, { status: 500 });
  }
}
