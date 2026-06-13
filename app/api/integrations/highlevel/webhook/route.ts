import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/* ============================================================================
 * POST /api/integrations/highlevel/webhook
 *
 * Receives engagement events from HighLevel (email opens, clicks, replies,
 * call completed, unsubscribes) and surfaces them as inbox_items so HL
 * engagement closes the loop back into the OS relationship intelligence layer.
 *
 * Auth: Bearer token via HIGHLEVEL_WEBHOOK_SECRET (if configured).
 * Never-block: any infra failure returns 200 to prevent HL retry storms.
 * ========================================================================= */

interface HLEngagementPayload {
  type: string;
  contactId?: string;
  contactEmail?: string;
  contactName?: string;
  orgId?: string;
  subject?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

const HL_CHANNEL_MAP: Record<string, string> = {
  email_opened: 'email',
  email_clicked: 'email',
  email_replied: 'email',
  sms_replied: 'sms',
  call_completed: 'call'
};

export async function POST(req: Request): Promise<NextResponse> {
  // Verify shared secret when configured.
  const secret = process.env.HIGHLEVEL_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let payload: HLEngagementPayload;
  try {
    payload = (await req.json()) as HLEngagementPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const channel = HL_CHANNEL_MAP[payload.type];
  if (!channel || !payload.orgId) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Surface HL engagement as an inbox_item so it flows into warmth scoring.
  try {
    const admin = createAdminClient();
    await (admin as unknown as {
      from: (t: string) => {
        upsert: (row: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }) => Promise<unknown>;
      };
    })
      .from('inbox_items')
      .upsert(
        {
          org_id: payload.orgId,
          channel,
          direction: 'inbound',
          external_id: `hl:${payload.type}:${payload.contactId ?? payload.contactEmail ?? 'unknown'}:${Date.now()}`,
          thread_id: null,
          reply_to_message_id: null,
          contact_id: null,
          subject: payload.subject ?? `HighLevel: ${payload.type.replace(/_/g, ' ')}`,
          preview: payload.contactName
            ? `${payload.contactName} ${payload.type.replace(/_/g, ' ')} via HighLevel.`
            : `HighLevel engagement: ${payload.type.replace(/_/g, ' ')}.`,
          score: payload.type.includes('replied') ? 70 : 45,
          status: 'pending',
          rationale: [
            { factor: 'channel', weight: channel === 'email' ? 25 : 18, detail: `HighLevel ${channel} engagement.` },
            { factor: 'recency', weight: 30, detail: 'Arrived in the last day.' },
            { factor: 'relationship', weight: 5, detail: 'HighLevel contact — match to network pending.' },
            { factor: 'responsiveness', weight: payload.type.includes('replied') ? 10 : 0, detail: payload.type.includes('replied') ? 'Reply received.' : 'Passive engagement.' }
          ],
          occurred_at: payload.occurredAt ?? new Date().toISOString()
        },
        { onConflict: 'org_id,channel,external_id', ignoreDuplicates: true }
      );
  } catch {
    // Never-block — HL must not retry-storm on infra failures.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
