import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getTrustCenterData } from '@/lib/queries/trust-center';
import { TrustDrawerHost } from '@/components/shell/trust/TrustDrawerHost';
import { TrustCenterView } from '@/components/trust/TrustCenterView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Trust Center' },
  description:
    'Org-wide Chain-of-Trust posture: a capital-weighted Institutional Readiness Index, the capital it secures, the governance queue, and the highest-leverage proof to close next.'
};

/**
 * Trust Center — the standalone /trust surface.
 *
 * Where the dashboard strip shows one member's chain and the drawer shows one
 * record, this rolls every Chain of Trust in the org into a single posture and
 * ties it to the capital it secures. It reuses the existing pieces rather than
 * rebuilding them: the shared `TrustDrawer` (mounted via `TrustDrawerHost`) for
 * record detail and `approveEvidence` for governance. The Audit Trail (/audit)
 * remains the home for the full event log — this page drives action, not history.
 */
export default async function TrustPage() {
  const org = await getActiveOrg().catch(() => null);
  const data = org ? await getTrustCenterData(org.orgId).catch(() => null) : null;

  return (
    <AuthedShell title="Trust Center" subtitle="Chain of Trust" redirectFrom="/trust">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {data ? (
          <TrustDrawerHost>
            <TrustCenterView data={data} />
          </TrustDrawerHost>
        ) : (
          <div className="rounded-2xl border border-hairline bg-surface-1 p-10 text-center">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Trust Center
            </p>
            <p className="mt-2 text-[13px] text-fg-2">
              Your workspace is still being set up. Refresh in a moment.
            </p>
          </div>
        )}
      </div>
    </AuthedShell>
  );
}
