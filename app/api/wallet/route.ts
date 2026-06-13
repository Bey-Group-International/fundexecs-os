import { NextResponse } from 'next/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getWalletSummary } from '@/lib/credits/wallet-summary';

/**
 * GET /api/wallet — the active org's wallet summary for the top-nav chip.
 *
 * Lets the wallet chip self-resolve its balance + low-balance state on any
 * authenticated screen, so it reads identically everywhere instead of
 * depending on each page to thread the wallet prop through its shell. Returns
 * `null` when there is no session / active org, which the chip renders as
 * nothing (no layout-shifting stub).
 */
export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json(null);
    const wallet = await getWalletSummary(org.orgId).catch(() => null);
    return NextResponse.json(wallet);
  } catch {
    return NextResponse.json(null);
  }
}
