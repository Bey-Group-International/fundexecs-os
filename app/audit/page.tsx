import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuditData } from '@/lib/queries/audit';
import { AuditView } from '@/components/audit/AuditView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit Trail',
  description:
    'A chronological timeline of Chain-of-Trust events, admin actions, and diligence findings for your organization.',
  openGraph: {
    title: 'Audit Trail · FundExecs OS',
    description: 'Chain-of-Trust events, admin actions, and diligence findings — on the record.'
  }
};

/**
 * Audit Trail — full UI over trust_events + admin_actions + diligence_findings.
 *
 * Merges all three sources into a filterable, searchable chronological timeline.
 * Binds to the typed `getAuditData` loader with a graceful empty state when no
 * data is available. Placeholder fallback when loader is not yet wired.
 */
export default async function AuditPage() {
  const org = await getActiveOrg().catch(() => null);

  const data = org
    ? await getAuditData(org.orgId).catch(() => ({ events: [], empty: true }))
    : { events: [], empty: true };

  return (
    <AuthedShell title="Audit Trail" subtitle="Chain of Trust" redirectFrom="/audit">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <AuditView data={data} />
      </div>
    </AuthedShell>
  );
}
