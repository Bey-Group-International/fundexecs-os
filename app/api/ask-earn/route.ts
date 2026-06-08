import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { streamEarn, type EarnMessage, type EarnSource } from '@/lib/ai/earn';

interface EarnContextHintBody {
  kind?: string;
  entityId?: string;
  entityLabel?: string;
}

const FALLBACK = {
  missing_key:
    "Earn is briefly offline — the team's still here, but I can't chat right now. Try again in a moment, or pick one of the suggested actions.",
  claude_error:
    "I'm having trouble thinking that through right now. Give me a second and try again — or jump to one of the recommended actions below.",
  rag_error:
    "I couldn't reach the team's knowledge for that one. Try again, or open a workflow from the recommended actions."
} as const;

/**
 * POST /api/ask-earn — chat with Earn, streamed as newline-delimited JSON.
 *
 * Body: { messages: EarnMessage[], context?: { kind, entityId, entityLabel } }.
 * Auth/org/payload failures return their 4xx JSON as before. Once validated, the
 * response is an `application/x-ndjson` stream of events, one JSON object/line:
 *   { type: 'sources', sources }   — brain citations (once, before deltas)
 *   { type: 'delta', text }        — a chunk of the reply
 *   { type: 'degraded', message }  — calm fallback (never a 5xx)
 *   { type: 'done' }               — end of turn
 *
 * The latest user turn is persisted up front and the assistant turn on
 * completion, so the dock can restore the thread on next open.
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

  let body: { messages?: EarnMessage[]; dealId?: string; context?: EarnContextHintBody };
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

  const context = body.context;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  // Persist the latest user turn immediately (best-effort — never blocks chat).
  if (lastUser) {
    await supabase
      .from('earn_messages')
      .insert({ user_id: user.id, org_id: org.orgId, role: 'user', content: lastUser.content })
      .then(undefined, () => {});
  }

  const encoder = new TextEncoder();
  const line = (obj: unknown) => encoder.encode(JSON.stringify(obj) + '\n');

  /** Save an assistant turn (best-effort). */
  const saveAssistant = async (content: string, sources: EarnSource[]) => {
    if (!content.trim()) return;
    await supabase
      .from('earn_messages')
      .insert({
        user_id: user.id,
        org_id: org.orgId,
        role: 'assistant',
        content,
        sources: sources as unknown as never
      })
      .then(undefined, () => {});
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Never-block: no API key → calm degraded message.
      if (!process.env.ANTHROPIC_API_KEY) {
        controller.enqueue(line({ type: 'degraded', message: FALLBACK.missing_key }));
        controller.enqueue(line({ type: 'done' }));
        controller.close();
        return;
      }

      // Diligence is a write: it is NOT auto-run here. Earn proposes the
      // `run_diligence` tool, which surfaces a confirm card (confirm-on-write)
      // in the normal streaming path below.

      // Normal streaming chat path.
      try {
        const { sources, deltas, tools } = await streamEarn(
          supabase,
          org.orgId,
          messages,
          {
            kind: context?.kind,
            entityId: context?.entityId,
            entityLabel: context?.entityLabel
          },
          user.id
        );
        if (sources.length) controller.enqueue(line({ type: 'sources', sources }));
        let full = '';
        for await (const chunk of deltas) {
          full += chunk;
          controller.enqueue(line({ type: 'delta', text: chunk }));
        }
        // Reactive actions Earn proposed (navigate auto-runs client-side;
        // mutating tools render a confirm card). Isolated so a tool-extraction
        // failure can't clobber the already-streamed reply with a degraded msg.
        let actions: Awaited<ReturnType<typeof tools>> = [];
        try {
          actions = await tools();
        } catch {
          actions = [];
        }
        for (const action of actions) {
          controller.enqueue(line({ type: 'action', action }));
        }
        controller.enqueue(line({ type: 'done' }));
        await saveAssistant(full, sources);
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        const isRag = /knowledge|chunks|vector|embedding|retriev|voyage/i.test(message);
        controller.enqueue(
          line({ type: 'degraded', message: isRag ? FALLBACK.rag_error : FALLBACK.claude_error })
        );
        controller.enqueue(line({ type: 'done' }));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no'
    }
  });
}
