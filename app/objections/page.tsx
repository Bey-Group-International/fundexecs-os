import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getObjectionsData, type ObjectionsData } from '@/lib/queries/objections';
import { ObjectionsView } from '@/components/objections/ObjectionsView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Objections',
  description:
    'An objection library and resolution loop — fees, track record, team, strategy, timing — each tied to its LP and a drafted rebuttal, tracked open vs. resolved.',
  openGraph: {
    title: 'Objections · FundExecs OS',
    description: 'Log LP objections, draft rebuttals, and track resolution across the raise.'
  }
};

const EMPTY: ObjectionsData = {
  items: [],
  total: 0,
  openCount: 0,
  resolvedCount: 0,
  resolutionPct: 0,
  categories: [],
  lps: [],
  empty: true
};

/**
 * Objections — full UI over the `objections` table with mutations through the
 * EXISTING `upsert_objection` / `resolve_objection` RPCs. Binds to the typed
 * `getObjectionsData` loader with a graceful empty state. No migrations.
 */
export default async function ObjectionsPage() {
  const org = await getActiveOrg().catch(() => null);
  const data = org ? await getObjectionsData(org.orgId).catch(() => EMPTY) : EMPTY;

  return (
    <AuthedShell title="Objections" subtitle="Capital Formation" redirectFrom="/objections">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <ObjectionsView data={data} />
      </div>
    </AuthedShell>
  );
}
