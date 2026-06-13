import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/* ============================================================================
 * POST /api/integrations/tasklets/webhook
 *
 * Receives completion events from Tasklets.ai:
 *   - partner_intro_reminder_sent — Tasklets.ai fired a 48h follow-up
 *   - lead_routed               — Tasklets.ai confirmed routing decision
 *   - brand_content_scheduled   — content queued in HL calendar
 *
 * Auth: TASKLETS_WEBHOOK_SECRET is REQUIRED — requests without a valid
 * Bearer token are rejected 401. Never fail-open on a missing secret.
 * Never-block: returns 200 on all DB failure paths.
 * ========================================================================= */

interface TaskletsPayload {
  type: string;
  introRequestId?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  // Fail-closed: require the shared secret to be configured.
  const secret = process.env.TASKLETS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: TaskletsPayload;
  try {
    payload = (await req.json()) as TaskletsPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    if (payload.type === 'partner_intro_reminder_sent' && payload.introRequestId) {
      if (!UUID_RE.test(payload.introRequestId)) {
        return NextResponse.json({ error: 'Invalid introRequestId' }, { status: 400 });
      }
      const occurredAt =
        payload.occurredAt && !isNaN(Date.parse(payload.occurredAt))
          ? payload.occurredAt
          : new Date().toISOString();
      // createAdminClient inside try so config errors are caught non-blocking.
      const admin = createAdminClient();
      // Record that a reminder fired. Use typed update to satisfy Supabase types.
      await admin
        .from('partner_intro_requests')
        .update({ updated_at: occurredAt })
        .eq('id', payload.introRequestId)
        .in('status', ['requested', 'accepted']);
    }
  } catch {
    // Never-block.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
