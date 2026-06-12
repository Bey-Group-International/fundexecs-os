import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { runAnchorBatch } from '@/lib/anchor/anchor.server';

/* ============================================================================
 * /api/cron/anchor — the trust-anchoring fold worker.
 *
 * Triggered by Vercel Cron (see vercel.json). Folds all pending anchor leaves
 * into one Merkle root and records the batch via the `local` provider (no
 * chain, no key, no network in the internal-first MVP). Auth mirrors the
 * intelligence cron: header-only `Authorization: Bearer <CRON_SECRET>`,
 * constant-time compared so the secret can't leak through logs or timing.
 * Never-block: returns 200 with a summary even on partial failure.
 * ========================================================================= */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
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
  const summary = await runAnchorBatch();
  return NextResponse.json({ durationMs: Date.now() - startedAt, ...summary });
}
