import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { askEarn, type EarnMessage } from '@/lib/ai/earn';

/**
 * POST /api/ask-earn — chat with Earn (RAG over the 15 brains + Claude).
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }.
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Earn is not configured yet — set ANTHROPIC_API_KEY.' },
      { status: 503 }
    );
  }

  try {
    const reply = await askEarn(supabase, org.orgId, messages);
    return NextResponse.json(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Earn failed to respond';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
