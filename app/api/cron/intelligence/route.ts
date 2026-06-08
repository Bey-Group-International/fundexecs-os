import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { runIntelligenceCycle } from '@/lib/ai/intelligence-pipeline';

/* ============================================================================
 * /api/cron/intelligence — the scheduled self-aware loop.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends the request with
 * `Authorization: Bearer <CRON_SECRET>`; we require that to match so the
 * endpoint can't be invoked by anyone else. Auth is header-only — never a
 * query param — so the secret can't leak through logs, history, or referrers.
 * Manual runs pass `-H "Authorization: Bearer <CRON_SECRET>"`. Runs the full
 * ingest → embed → network → score → judge → brief
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

  // Header-only: never accept the secret as a query param (avoids leaking it
  // through logs, browser history, or referrers). Compared in constant time so
  // the check doesn't leak the secret length/prefix via response timing.
  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
