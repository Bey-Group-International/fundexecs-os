import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { askEarn, type EarnMessage } from '@/lib/ai/earn';
import { earnReviewDeal } from '@/lib/diligence';

/**
 * Detect a clear "review/diligence this deck/deal like an institutional LP"
 * instruction. Deliberately conservative: it must mention BOTH a review-style
 * verb (review/diligence/vet/assess) AND a deal-ish object (deal/deck/company/
 * opportunity/pitch). Anything ambiguous returns false so the normal chat path
 * runs unchanged.
 */
function isDiligenceIntent(message: string): boolean {
  const m = message.toLowerCase();
  const hasReviewVerb =
    /\b(run\s+diligence|due\s+diligence|diligence|vet|review|assess|evaluate)\b/.test(m);
  const hasDealObject = /\b(deal|deck|company|opportunity|pitch|startup|investment)\b/.test(m);
  return hasReviewVerb && hasDealObject;
}

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

  let body: { messages?: EarnMessage[]; dealId?: string };
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

  // --- Additive diligence intent (safe pre-pass) ---------------------------
  // ONLY when the latest user message clearly asks for a diligence-style review.
  // On any non-match we fall straight through to the unchanged askEarn flow.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser && isDiligenceIntent(lastUser.content)) {
    if (body.dealId) {
      // A deal is resolvable from context — run the real 7-agent review.
      try {
        const user = await getAuthUser();
        if (user) {
          const result = await earnReviewDeal({
            orgId: org.orgId,
            createdBy: user.id,
            dealId: body.dealId
          });
          if (result.status === 'complete') {
            const conviction =
              result.conviction != null ? `Conviction ${result.conviction}/100. ` : '';
            return NextResponse.json({
              text:
                `I ran the full committee on this deal. ${conviction}` +
                `See the breakdown and my memo here: /diligence/${result.runId}`,
              sources: []
            });
          }
          return NextResponse.json({
            text:
              `I started a diligence run but it didn't complete cleanly. ` +
              `You can review what came back here: /diligence/${result.runId}`,
            sources: []
          });
        }
      } catch {
        // Fall through to the guidance reply below if the run can't be started.
      }
    }
    // No deal context (or run couldn't start) — guide the user, don't guess.
    return NextResponse.json({
      text:
        'I can run a full institutional-grade diligence review, but I need to know which deal. ' +
        'Open the deal in your Pipeline and hit "Run diligence" in the deal drawer — ' +
        "I'll have the committee weigh in and post a memo to /diligence.",
      sources: []
    });
  }
  // --- End diligence intent pre-pass ---------------------------------------

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
