import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { askEarn, type EarnMessage } from '@/lib/ai/earn';

/**
 * POST /api/ask-earn — chat with Earn (RAG over the 15 brains + Claude).
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }.
 *
 * Response shape (always HTTP 200 once auth + org are valid):
 *   - success:   { reply: string, ... }                 (from askEarn)
 *   - degraded:  { ok: false, degraded: true,
 *                  fallback_message: string,
 *                  reason: 'missing_key' | 'claude_error' | 'rag_error' }
 *
 * "Never block" rule: a missing ANTHROPIC_API_KEY or a downstream Claude
 * failure must NEVER produce a 5xx — Earn is a guide, not a hard dependency.
 * Auth + org errors still return their respective 4xx codes.
 */

type DegradeReason = 'missing_key' | 'claude_error' | 'rag_error';

function degraded(reason: DegradeReason, message: string) {
  return NextResponse.json({
    ok: false,
    degraded: true,
    fallback_message: message,
    reason
  });
}

const FALLBACK = {
  missing_key:
    "Earn is briefly offline — the team's still here, but I can't chat right now. Try again in a moment, or pick one of the suggested actions.",
  claude_error:
    "I'm having trouble thinking that through right now. Give me a second and try again — or jump to one of the recommended actions below.",
  rag_error:
    "I couldn't reach the team's knowledge for that one. Try again, or open a workflow from the recommended actions."
} as const satisfies Record<DegradeReason, string>;

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

  let body: { messages?: EarnMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter(
      (m): m is EarnMessage =>
        m != null &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    )
    .slice(-12);

  if (messages.length === 0) {
    return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
  }

  // Never-block: missing API key returns the degraded shape (HTTP 200) so the
  // Copilot dock surfaces a calm system message instead of an error toast.
  if (!process.env.ANTHROPIC_API_KEY) {
    return degraded('missing_key', FALLBACK.missing_key);
  }

  try {
    const reply = await askEarn(supabase, org.orgId, messages);
    return NextResponse.json(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    // Distinguish a retrieval failure from a Claude failure when we can.
    const isRag =
      /knowledge|chunks|vector|embedding|retriev/i.test(message) || /voyage/i.test(message);
    return degraded(
      isRag ? 'rag_error' : 'claude_error',
      isRag ? FALLBACK.rag_error : FALLBACK.claude_error
    );
  }
}
