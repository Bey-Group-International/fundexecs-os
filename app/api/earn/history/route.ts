import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EarnSource } from '@/lib/ai/earn';

export interface EarnHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: EarnSource[];
}

/**
 * GET /api/earn/history — the signed-in user's persisted Earn thread (oldest
 * first, capped) so the dock can restore the conversation on open. Returns an
 * empty list for signed-out users rather than erroring, so the dock degrades to
 * a fresh thread.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ messages: [] });

    const { data } = await supabase
      .from('earn_messages')
      .select('role, content, sources')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    const messages: EarnHistoryMessage[] = (data ?? []).reverse().map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      sources: Array.isArray(m.sources) ? (m.sources as unknown as EarnSource[]) : []
    }));

    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}
