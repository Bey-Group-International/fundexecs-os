import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { deriveCockpit } from '@/lib/dashboard/cockpit';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain, LoopVerb } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
import { ProfileRailSummary } from '@/components/profile';
import { VerbHubView } from './VerbHubView';

/**
 * VerbHubPage — the shared server scaffold behind /build /source /run /drive.
 *
 * Every hub page does the same dance: resolve identity (redirect to login),
 * resolve the org (calm zero-state), load the verb's workspace defensively
 * (calm fallback instead of a 500), derive rail signals from the same
 * dashboard payload, and render `VerbHubView` inside the shell. The pages
 * stay one-screen thin: a loader, a title, and the hero copy.
 */

/** What every verb loader returns (the per-verb workspaces all satisfy it). */
export interface VerbHubWorkspace {
  panels: HubPanel[];
  headline: HubHeadline;
  focusKey: string | null;
  pulse: VerbPulse | null;
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

export interface VerbHubPageProps<W extends VerbHubWorkspace> {
  verb: LoopVerb;
  title: string;
  subtitle: string;
  /** Path used in the login redirect, e.g. "/source". */
  path: string;
  /** The verb's aggregate loader. */
  load: (orgId: string) => Promise<W>;
  /** Hero eyebrow, e.g. "Source — find what fits". */
  eyebrow: string;
  /** Hero sentence — may read workspace numbers (e.g. locked capital). */
  describe: (workspace: W) => string;
  /** Section header above the panel grid. */
  panelsTitle: string;
}

function FallbackCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-8 text-center">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">{title}</p>
      <p className="mt-2 text-[13px] text-fg-2">{body}</p>
    </Card>
  );
}

export async function VerbHubPage<W extends VerbHubWorkspace>({
  verb,
  title,
  subtitle,
  path,
  load,
  eyebrow,
  describe,
  panelsTitle
}: VerbHubPageProps<W>) {
  const identity = await getShellIdentity();
  if (!identity) redirect(`/login?redirectedFrom=${encodeURIComponent(path)}`);

  const org = await getActiveOrg();
  if (!org) {
    return (
      <AppShell title={title} subtitle={subtitle} identity={identity}>
        <FallbackCard
          title="No workspace yet"
          body="Your workspace is being set up. Refresh in a moment."
        />
      </AppShell>
    );
  }

  const [workspace, memberProfile, wallet, fundProfile] = await Promise.all([
    load(org.orgId).catch((err) => {
      console.error(`[VerbHubPage:${verb}] Failed to load workspace:`, err);
      return null;
    }),
    getMemberProfile().catch(() => null),
    getCreditWallet(org.orgId).catch(() => null),
    getFundProfile(org.orgId).catch(() => null)
  ]);

  if (!workspace) {
    return (
      <AppShell title={title} subtitle={subtitle} identity={identity} wallet={wallet}>
        <FallbackCard
          title={`${title} hub unavailable`}
          body="We couldn't load your workspace right now. Refresh in a moment."
        />
      </AppShell>
    );
  }

  const navSignals = buildRailSignals(workspace.dashboard, memberProfile?.memberType ?? null);
  // Per-verb readiness from the cockpit model — the same number the rail and
  // Command Center show for this verb, so the hub header agrees with both.
  const readyPct = deriveCockpit(workspace.dashboard).find((h) => h.key === verb)?.pct ?? 0;

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={fundProfile ? <ProfileRailSummary profile={fundProfile} /> : undefined}
    >
      <VerbHubView
        verb={verb}
        eyebrow={eyebrow}
        description={describe(workspace)}
        headline={workspace.headline}
        readyPct={readyPct}
        pulse={workspace.pulse}
        chain={workspace.chain}
        nextBestAction={workspace.nextBestAction}
        panels={workspace.panels}
        focusKey={workspace.focusKey}
        panelsTitle={panelsTitle}
      />
    </AppShell>
  );
}
