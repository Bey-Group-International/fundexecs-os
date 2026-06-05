import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMemberType } from '@/lib/member-types';
import { getQuestion } from '@/lib/proof-of-truth/questions';
import { recommendProfileAnswers } from '@/lib/ai/profile-suggest';

/**
 * POST /api/earn/profile-suggest — Earn's three recommended answers for one
 * Proof of Truth profile field.
 *
 * Body: { memberType, questionId, answers?: Record<string,string>, disliked?: string[] }
 * Returns: { ok: true, insight, options } on success, or { ok: false, degraded: true }
 * (HTTP 200) whenever Earn is unavailable — so the UI always falls back to
 * manual entry instead of blocking profile creation.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { memberType?: unknown; questionId?: unknown; answers?: unknown; disliked?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isMemberType(body.memberType)) {
    return NextResponse.json({ error: 'Invalid member type' }, { status: 400 });
  }
  if (typeof body.questionId !== 'string') {
    return NextResponse.json({ error: 'Missing questionId' }, { status: 400 });
  }

  const question = getQuestion(body.memberType, body.questionId);
  if (!question) {
    return NextResponse.json({ error: 'Unknown question' }, { status: 400 });
  }

  // Sanitize prior answers: string→string, capped count + length.
  const answers: Record<string, string> = {};
  if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    let n = 0;
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        answers[k.slice(0, 60)] = v.trim().slice(0, 600);
        if (++n >= 40) break;
      }
    }
  }

  // Sanitize the disliked list: non-empty strings, capped count + length.
  const disliked: string[] = [];
  if (Array.isArray(body.disliked)) {
    for (const v of body.disliked) {
      if (typeof v === 'string' && v.trim()) {
        disliked.push(v.trim().slice(0, 600));
        if (disliked.length >= 12) break;
      }
    }
  }

  // Earn unavailable → degrade gracefully (manual entry on the client).
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, degraded: true });
  }

  try {
    const { insight, options } = await recommendProfileAnswers({
      memberType: body.memberType,
      question,
      answers,
      disliked
    });
    return NextResponse.json({ ok: true, insight, options });
  } catch {
    // Timeout / rate limit / malformed output — never block the user.
    return NextResponse.json({ ok: false, degraded: true });
  }
}
