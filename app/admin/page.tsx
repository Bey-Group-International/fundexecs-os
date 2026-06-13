import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Download, FileClock } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getAccessApplicants } from '@/lib/queries/admin-access';
import { getAdminMetrics } from '@/lib/queries/admin-metrics';
import { getBetaInvites } from '@/lib/queries/beta-invites';
import { getActiveOrg } from '@/lib/queries/org';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { AccessInbox } from './AccessInbox';
import { BetaInvitesPanel } from './BetaInvitesPanel';
import { MetricsStrip } from './MetricsStrip';

export const metadata: Metadata = { title: 'Admin · Beta access' };

// Decisions and emails are per-request and must never be cached.
export const dynamic = 'force-dynamic';

/**
 * Admin portal — beta access control. Platform-admin (Bey Group) only: the gate
 * runs first and bounces anyone else to their command center. Surfaces the
 * platform-health strip, the Applications inbox (approve / decline / reset) over
 * the enforced `member_profiles.access_status` gate, invite-by-email, plus
 * one-click CSV exports (applicants + audit log).
 */
export default async function AdminPage() {
  if (!(await requirePlatformAdmin())) redirect('/command-center');

  const org = await getActiveOrg();
  const [applicants, metrics, invites] = await Promise.all([
    getAccessApplicants(),
    org ? getAdminMetrics(org.orgId) : Promise.resolve(null),
    org ? getBetaInvites(org.orgId) : Promise.resolve([])
  ]);
  const pendingCount = applicants.filter((a) => a.access === 'pending').length;

  return (
    <main className="min-h-dvh bg-bg-0 text-fg-1">
      <header className="border-b border-hairline bg-bg-1/60 backdrop-blur">
        <div className="mx-auto flex max-w-[960px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <EarnCoin size={28} />
            <div>
              <p className="text-[14px] font-semibold tracking-[-0.02em]">FundExecs OS · Admin</p>
              <p className="text-[11.5px] text-fg-4">Private beta access control</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/audit/export"
              prefetch={false}
              className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2 text-[12.5px] text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <FileClock size={14} aria-hidden />
              Audit log
            </Link>
            <Link
              href="/admin/export"
              prefetch={false}
              className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2 text-[12.5px] text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <Download size={14} aria-hidden />
              Export CSV
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[960px] px-6 py-8">
        {metrics && <MetricsStrip metrics={metrics} />}

        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Applications</h1>
          <p className="mt-1 text-[13px] text-fg-3">
            {pendingCount > 0
              ? `${pendingCount} application${pendingCount === 1 ? '' : 's'} waiting on a decision.`
              : 'Everyone who has signed up for the beta, and their access decision.'}
          </p>
        </div>

        <AccessInbox applicants={applicants} />

        <BetaInvitesPanel invites={invites} />
      </div>
    </main>
  );
}
