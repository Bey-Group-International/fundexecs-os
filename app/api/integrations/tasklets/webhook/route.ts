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
 * On partner reminder: updates partner_intro_requests with last_reminder_at
 * so the OS knows a reminder went out and can reset the 48h window.
 *
 * Auth: Bearer token via TASKLETS_WEBHOOK_SECRET (if configured).
 * Never-block: returns 200 on all paths.
 * ========================================================================= */

interface TaskletsPayload {
  type: string;
  introRequestId?: string;
  leadId?: string;
  orgId?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.TASKLETS_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let payload: TaskletsPayload;
  try {
    payload = (await req.json()) as TaskletsPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const admin = createAdminClient();

  try {
    if (payload.type === 'partner_intro_reminder_sent' && payload.introRequestId) {
      // Record that a reminder fired — Tasklets.ai will re-arm its own timer.
      await admin
        .from('partner_intro_requests')
        .update({ updated_at: payload.occurredAt ?? new Date().toISOString() } as Record<string, unknown>)
        .eq('id', payload.introRequestId)
        .in('status', ['requested', 'accepted']);
    }
  } catch {
    // Never-block.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
