import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/beta/ask — the live "ask Earn anything" box in the pre-auth beta
 * welcome experience.
 *
 * Anonymous, so it is gated three ways: a valid (active, unexpired, not-full)
 * beta link token; a short input + history cap; and a durable, Supabase-backed
 * rate limit (per token AND per IP) that holds across serverless instances.
 * Earn answers ONLY about FundExecs OS, the program, and the team — it makes no
 * commitments and has no org/RAG context. Streams newline-delimited JSON,
 * matching the app's Earn stream shape:
 *   { type: 'delta', text } … { type: 'done' } | { type: 'degraded', message }
 */

const MODEL = process.env.EARN_MODEL || 'claude-sonnet-4-6';
const MAX_INPUT = 600;
const MAX_HISTORY = 6;

// Durable rate-limit budgets (see migration 20260607170000_beta_ask_rate_limit).
const RATE_WINDOW_SECONDS = 600; // 10-minute fixed window
const RATE_MAX_TOKEN = 15; // per invite link
const RATE_MAX_IP = 30; // tighter per-IP cap to blunt token-sharing

const SYSTEM_PROMPT = `You are Earn — "Earnest Fundmaker, Chief Operating Officer" of a fifteen-strong AI executive team inside FundExecs OS, an AI-native private-market command center for funds, LPs, operators, capital providers, and ecosystem partners.

You are greeting a PROSPECTIVE member who just opened a private-beta invite link. They have not signed up yet. Your job: make them feel welcomed, explain what FundExecs OS and the private beta are, and answer their questions so they feel confident finishing the short application and joining.

Voice: institutional, declarative, operator-grade. Sentence case. Calm authority, short sentences, no hype, no emoji. A few short sentences per reply — never long.

What you can speak to: the unified private-market intelligence layer; the fifteen-strong AI executive team you lead; the Command Center, Pipeline, Chain of Trust, and Proof of Truth; the member types (investment firm, service provider, startup, student, individual investor); and what the beta offers (early access, shaping the product, working with the team).

Rules: never promise pricing, timelines, returns, or guarantees. Do not invent specific features you are unsure of. If asked something out of scope, say so briefly and steer back to getting started. If they seem ready, encourage them to finish the quick application to get in.`;

type Turn = { role: 'user' | 'assistant'; content: string };

/** One durable rate-limit bucket via the SECURITY DEFINER RPC. Fails OPEN on
 *  any error so a DB hiccup never blocks a genuine invitee. */
async function checkBucket(key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('beta_ask_rate_check', {
      _key: key,
      _window_seconds: windowSeconds,
      _max: max
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/** Allowed only when both the per-token and per-IP buckets are under budget. */
async function isAllowed(token: string, ip: string): Promise<boolean> {
  const [tokenOk, ipOk] = await Promise.all([
    checkBucket(`token:${token}`, RATE_WINDOW_SECONDS, RATE_MAX_TOKEN),
    checkBucket(`ip:${ip}`, RATE_WINDOW_SECONDS, RATE_MAX_IP)
  ]);
  return tokenOk && ipOk;
}

async function tokenIsClaimable(token: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from('beta_links')
    .select('id, max_uses, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!link || link.revoked_at) return false;
  if (new Date(link.expires_at).getTime() <= Date.now()) return false;
  const { count } = await admin
    .from('beta_link_claims')
    .select('id', { count: 'exact', head: true })
    .eq('beta_link_id', link.id);
  return (count ?? 0) < link.max_uses;
}

export async function POST(req: NextRequest) {
  let body: { token?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  if (!(await tokenIsClaimable(token))) {
    return NextResponse.json({ error: 'This invite link is not active.' }, { status: 403 });
  }

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  if (!(await isAllowed(token, ip))) {
    return NextResponse.json(
      { error: 'You’ve asked a lot — give Earn a short breather and try again in a few minutes.' },
      { status: 429 }
    );
  }

  const raw = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
  const messages: Turn[] = raw
    .filter(
      (m): m is Turn =>
        !!m &&
        typeof m === 'object' &&
        ((m as Turn).role === 'user' || (m as Turn).role === 'assistant') &&
        typeof (m as Turn).content === 'string'
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_INPUT) }));

  if (!messages.some((m) => m.role === 'user')) {
    return NextResponse.json({ error: 'Ask Earn a question first.' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return streamLine({
      type: 'degraded',
      message:
        'Earn is briefly offline — finish the quick application and meet the full team inside.'
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const anthropic = new Anthropic({ timeout: 20_000, maxRetries: 1 });
        const earnStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages
        });
        earnStream.on('text', (text) => send({ type: 'delta', text }));
        await earnStream.finalMessage();
        send({ type: 'done' });
      } catch {
        send({
          type: 'degraded',
          message:
            "I couldn't think that through just now. Try again, or finish the application to meet the team inside."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/** One-line NDJSON response (used for the env-missing degraded case). */
function streamLine(obj: unknown): NextResponse {
  return new NextResponse(JSON.stringify(obj) + '\n' + JSON.stringify({ type: 'done' }) + '\n', {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
  });
}
