import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Download, FileClock, LayoutDashboard, Mail, ShieldCheck, Users } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getAccessApplicants } from '@/lib/queries/admin-access';
import { getAdminMetrics } from '@/lib/queries/admin-metrics';
import { getBetaInvites } from '@/lib/queries/beta-invites';
import { getReferralOverview } from '@/lib/queries/referrals';
import { getActiveOrg } from '@/lib/queries/org';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Badge } from '@/components/ui/Badge';
import { AccessInbox } from './AccessInbox';
import { BetaInvitesPanel } from './BetaInvitesPanel';
import { MetricsStrip } from './MetricsStrip';
import { AdminReferrals } from './AdminReferrals';

export const metadata: Metadata = { title: 'Admin · Beta access' };

export const dynamic = 'force-dynamic';

const NAV_TABS = [
  { id: 'applications', label: 'Applications', icon: Users },
  { id: 'invites', label: 'Invites', icon: Mail },
  { id: 'referrals', label: 'Referrals', icon: ShieldCheck }
] as const;

type TabId = (typeof NAV_TABS)[number]['id'];

/**
 * Admin portal — rebuilt with tabbed navigation: Applications inbox, Invite
 * management, and platform Referral tracking. Platform-admin (Bey Group) only.
 */
export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await requirePlatformAdmin())) redirect('/command-center');

  const params = await searchParams;
  const rawTab = params.tab;
  const tabParam = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab: TabId = NAV_TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'applications';

  const org = await getActiveOrg();
  const [applicants, metrics, invites, referrals] = await Promise.all([
    getAccessApplicants(),
    org ? getAdminMetrics(org.orgId) : Promise.resolve(null),
    org ? getBetaInvites(org.orgId) : Promise.resolve([]),
    org ? getReferralOverview(org.orgId) : Promise.resolve(null)
  ]);
  const pendingCount = applicants.filter((a) => a.access === 'pending').length;

  return (
    <main className="min-h-dvh bg-bg-0 text-fg-1">
      {/* Header */}
      <header className="border-b border-hairline bg-bg-1/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <EarnCoin size={30} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-semibold tracking-[-0.02em]">FundExecs OS</p>
                <Badge tone="warning" className="text-[10px]">
                  Admin
                </Badge>
              </div>
              <p className="text-[11.5px] text-fg-4">
                Private beta access control · Bey Group internal
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/command-center"
              className="flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[12px] text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <LayoutDashboard size={13} aria-hidden />
              Dashboard
            </Link>
            <Link
              href="/admin/audit/export"
              prefetch={false}
              className="flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[12px] text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <FileClock size={13} aria-hidden />
              Audit log
            </Link>
            <Link
              href="/admin/export"
              prefetch={false}
              className="flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[12px] text-fg-2 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <Download size={13} aria-hidden />
              Export CSV
            </Link>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mx-auto max-w-[1040px] px-6">
          <nav className="flex items-end gap-0.5" aria-label="Admin sections">
            {NAV_TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              const badge = id === 'applications' && pendingCount > 0 ? pendingCount : null;
              return (
                <Link
                  key={id}
                  href={`/admin?tab=${id}`}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium transition ${
                    active
                      ? 'border-fg-1 text-fg-1'
                      : 'border-transparent text-fg-4 hover:border-fg-3 hover:text-fg-2'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={14} strokeWidth={1.9} aria-hidden />
                  {label}
                  {badge && (
                    <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1040px] px-6 py-8">
        {metrics && <MetricsStrip metrics={metrics} />}

        {tab === 'applications' && (
          <>
            <div className="mb-6">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Applications</h1>
              <p className="mt-1 text-[13px] text-fg-3">
                {pendingCount > 0
                  ? `${pendingCount} application${pendingCount === 1 ? '' : 's'} waiting on a decision.`
                  : 'Everyone who has signed up for the beta, and their access decision.'}
              </p>
            </div>
            <AccessInbox applicants={applicants} />
          </>
        )}

        {tab === 'invites' && (
          <>
            <div className="mb-6">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Invites</h1>
              <p className="mt-1 text-[13px] text-fg-3">
                Send magic-link invites by email — new invitees land on the welcome intro; the role
                applies when they accept.
              </p>
            </div>
            <BetaInvitesPanel invites={invites} />
          </>
        )}

        {tab === 'referrals' && (
          <>
            <div className="mb-6">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Referrals</h1>
              <p className="mt-1 text-[13px] text-fg-3">
                Platform-wide referral activity — who brought whom in, and what commission has been
                granted.
              </p>
            </div>
            <AdminReferrals referrals={referrals} />
          </>
        )}
      </div>
    </main>
  );
}
