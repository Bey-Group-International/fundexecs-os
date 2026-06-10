import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { runMeetingCopilot } from '@/lib/meeting-copilot/orchestrator';

/**
 * POST /api/meeting-copilot — run the 4-agent Meeting Copilot analysis over a
 * provided meeting transcript.
 *
 * Body: { transcript: string, contactName?: string, dealId?: string }
 *
 * Authorization: the request is gated to an authenticated user with an active
 * organization. Org membership is verified through `getActiveOrg` (which
 * re-validates the cookie's org against `org_members`) before any service-role
 * work happens in the orchestrator.
 *
 * Credit metering: a genuine shortfall returns 402 with an `upgradeTo` hint;
 * infrastructure failures fail open inside `meterAction` so a misconfig can't
 * block the feature.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: 'No organization yet' }, { status: 400 });
  }

  let body: { transcript?: unknown; contactName?: unknown; dealId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }
  // Guard against obviously too-short or too-long transcripts.
  if (transcript.length < 50) {
    return NextResponse.json(
      { error: 'transcript is too short to analyse (minimum 50 characters)' },
      { status: 400 }
    );
  }
  if (transcript.length > 200_000) {
    return NextResponse.json(
      { error: 'transcript exceeds the 200 000-character limit' },
      { status: 400 }
    );
  }

  const contactName = typeof body.contactName === 'string' ? body.contactName.trim() || null : null;
  const dealId = typeof body.dealId === 'string' ? body.dealId.trim() || null : null;

  const result = await runMeetingCopilot({
    orgId: org.orgId,
    createdBy: user.id,
    transcript,
    contactName,
    dealId
  });

  // Insufficient credits → 402 with an upgrade hint.
  if (result.status === 'insufficient_credits') {
    return NextResponse.json(
      {
        error: 'Insufficient credits — Meeting Copilot costs 10 credits.',
        upgradeTo: result.upgradeTo ?? null
      },
      { status: 402 }
    );
  }

  // All other statuses (complete, error) — return 200 with the typed result
  // so the client can render success or a calm degraded state without hitting a
  // 5xx boundary. The orchestrator never throws.
  return NextResponse.json(result);
}
