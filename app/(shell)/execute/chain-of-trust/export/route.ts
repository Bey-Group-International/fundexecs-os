import { NextResponse } from 'next/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getTrustCenterData } from '@/lib/queries/trust-center';
import { ledgerToCsv } from '@/lib/trust-ledger/vocabulary';

/**
 * Export ledger — the prototype's download action, made real: a
 * server-generated CSV of the org's Chain of Trust records (RLS-bound
 * through the same read path as the page), oldest first with block
 * numbers. No rows are invented; an empty ledger exports a header.
 */
export async function GET() {
  const org = await getActiveOrg();
  if (!org) return new NextResponse('No active workspace.', { status: 401 });

  const data = await getTrustCenterData(org.orgId);
  const csv = ledgerToCsv(
    data.records.map((r) => ({
      id: r.id,
      title: r.title,
      entityType: r.entityType,
      entityId: r.entityId,
      currentLayer: r.currentLayer,
      completion: r.score,
      status: r.status,
      createdAt: r.createdAt
    }))
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="chain-of-trust-ledger.csv"',
      'Cache-Control': 'no-store'
    }
  });
}
