import { redirect } from 'next/navigation';
import { Activity } from 'lucide-react';
import { RunHubTabs } from '@/components/hubs/RunHubTabs';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getLifecycleRail } from '@/lib/hubs';
import { getActiveOrg } from '@/lib/queries/org';

/**
 * The Run hub shell — the prototype's RunHub chrome around every module
 * route: hero with live readiness and the module tabs. Unlike Build/Source,
 * the prototype's Run hero carries no stat tiles — each tab brings its own
 * posture header (diligence verdict, compliance posture, IR cadence), so the
 * shell stays lean and the active module renders directly under the tabs.
 */
export default async function RunHubLayout({ children }: { children: React.ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const rail = await getLifecycleRail(org.orgId);
  const pct = rail.pct.run;

  return (
    <div className="fx-rise mx-auto flex max-w-[980px] flex-col gap-4">
      {/* hero — the prototype's Run header with live readiness */}
      <section className="rounded-2xl border border-hairline bg-bg-1 px-5 py-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Activity size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Run</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Operate the systems that move work forward. The team runs it; you review and approve.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{pct}%</div>
            <div className="text-[10.5px] text-fg-5">Run ready</div>
          </div>
        </div>
        <div className="mt-3.5">
          <ProgressBar value={pct} height={6} tone="gold" label="Run readiness" />
        </div>
      </section>

      <RunHubTabs />

      {children}
    </div>
  );
}
