import { NextResponse } from 'next/server';
import { runIntelligenceCycle } from '@/lib/ai/intelligence-pipeline';

/* ============================================================================
 * /api/cron/intelligence — the scheduled self-aware loop.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends the request with
 * `Authorization: Bearer <CRON_SECRET>`; we require that to match so the
 * endpoint can't be invoked by anyone else. Manual runs can pass the same
 * secret as `?secret=`. Runs the full ingest → embed → score → judge → brief
 * cycle and returns a JSON summary. Every phase inside the cycle is
 * never-block, so this route returns 200 with a summary even on partial
 * failure (the summary carries the errors).
 * ========================================================================= */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured → refuse rather than run an unauthenticated job.
  if (!secret) return false;

  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get('secret') === secret;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const summary = await runIntelligenceCycle();
  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    ...summary
  });
}
