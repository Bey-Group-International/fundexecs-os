import { NextResponse } from 'next/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';

/**
 * GET /api/wallet — the active org's Earn-coins wallet for the top-nav module.
 *
 * Lets the wallet component self-resolve its balance on any authenticated
 * screen, so it reads identically everywhere instead of depending on each page
 * to thread the `wallet` prop through its shell (which left some screens showing
 * a balance and others showing the empty stub). Returns `null` when there is no
 * session / active org, which the gauge renders as its clean unconfigured stub.
 */
export async function GET() {
  try {
    const org = await getActiveOrg();
    if (!org) return NextResponse.json(null);
    const wallet = await getCreditWallet(org.orgId).catch(() => null);
    return NextResponse.json(wallet);
  } catch {
    return NextResponse.json(null);
  }
}
