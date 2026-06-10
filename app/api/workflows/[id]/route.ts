import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { advanceWorkflowStep, getWorkflow } from '@/lib/workflows/engine';
import { WORKFLOW_STEP_STATUSES, type WorkflowStepStatus } from '@/lib/workflows/types';

/**
 * GET /api/workflows/[id] — fetch the full workflow state (envelope + steps).
 *
 * Responses:
 *   200 { workflow: WorkflowRecord }
 *   401 — not authenticated
 *   403 — no active org
 *   404 — workflow not found (or not a member of its org)
 *   500 — db error
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // — Auth -------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: 'No active organization.' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Workflow id is required.' }, { status: 400 });
  }

  const result = await getWorkflow(org.orgId, id);

  if (result.ok) {
    return NextResponse.json({ workflow: result.workflow });
  }
  if (result.reason === 'not_found') {
    return NextResponse.json({ error: 'Workflow not found.' }, { status: 404 });
  }
  return NextResponse.json({ error: result.message }, { status: 500 });
}

/**
 * PATCH /api/workflows/[id] — advance a single step.
 *
 * Body:
 *   stepId   string             — the earn_workflow_steps row id
 *   toStatus WorkflowStepStatus — target status
 *
 * Responses:
 *   200 { ok: true }
 *   400 { error }               — invalid input / illegal transition
 *   401                         — not authenticated
 *   402 { error }               — insufficient credits
 *   403 { error }               — no active org
 *   404 { error }               — step / workflow not found
 *   500 { error }               — db / infra error
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // — Auth -------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: 'No active organization.' }, { status: 403 });
  }

  const { id: workflowId } = await params;
  if (!workflowId) {
    return NextResponse.json({ error: 'Workflow id is required.' }, { status: 400 });
  }

  // — Parse body -------------------------------------------------------------
  let body: { stepId?: unknown; toStatus?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const stepId = typeof body.stepId === 'string' ? body.stepId.trim() : '';
  if (!stepId) {
    return NextResponse.json({ error: '"stepId" is required.' }, { status: 400 });
  }

  const toStatus = typeof body.toStatus === 'string' ? body.toStatus.trim() : '';
  if (!(WORKFLOW_STEP_STATUSES as readonly string[]).includes(toStatus)) {
    return NextResponse.json(
      { error: `"toStatus" must be one of: ${WORKFLOW_STEP_STATUSES.join(', ')}.` },
      { status: 400 }
    );
  }

  // — Engine -----------------------------------------------------------------
  const result = await advanceWorkflowStep({
    orgId: org.orgId,
    userId: user.id,
    workflowId,
    stepId,
    toStatus: toStatus as WorkflowStepStatus
  });

  if (result.ok) {
    return NextResponse.json({ ok: true });
  }

  switch (result.reason) {
    case 'not_found':
      return NextResponse.json({ error: result.message }, { status: 404 });
    case 'invalid_transition':
      return NextResponse.json(
        { error: `Illegal transition: ${result.from} → ${result.to}.` },
        { status: 400 }
      );
    case 'insufficient_credits':
      return NextResponse.json(
        { error: 'Insufficient credits to advance this step.', balance: result.balance },
        { status: 402 }
      );
    case 'db_error':
      return NextResponse.json({ error: result.message }, { status: 500 });
  }
}
