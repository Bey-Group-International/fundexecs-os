import { redirect } from 'next/navigation';
import { AppShell, type ShellHub } from '@/components/shell/AppShell';
import { getLifecycleRail } from '@/lib/hubs';
import { HUB_META, hubContent } from '@/lib/hubs/lifecycle';
import { mandateCfg, type InvestorGroup } from '@/lib/onboarding/mandate';
import { getShellIdentity } from '@/lib/queries/identity';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';
import { signOutAction } from './actions';

/**
 * The authenticated lifecycle shell — wraps the Command Center and the four
 * verb hubs in the prototype's chrome: rail + topbar with live, role-aware
 * readiness. One load here feeds every surface inside the group.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, identity, rail] = await Promise.all([
    getMandate(org.orgId),
    getShellIdentity(),
    getLifecycleRail(org.orgId)
  ]);

  const group = (mandate?.investor_group as InvestorGroup) ?? 'fund';
  const cfg = mandateCfg(group);
  const sizeLabel = cfg.sizes.find((s) => s.id === mandate?.size)?.label;

  const hubs: ShellHub[] = HUB_META.map((meta) => {
    const content = hubContent(group, meta.id);
    return {
      id: meta.id,
      label: meta.label,
      tag: meta.tag,
      icon: meta.icon,
      href: meta.href,
      pct: rail.pct[meta.id],
      modules: content.modules.map(({ label, icon }) => ({ label, icon }))
    };
  });

  const level = identity?.level ?? 1;
  const role = mandate?.investor_role ?? identity?.role ?? 'Operator';

  return (
    <AppShell
      firm={mandate?.firm ?? identity?.orgName ?? 'Your desk'}
      firmSub={sizeLabel ? `${sizeLabel} ${cfg.sizeLabel.toLowerCase()}` : role}
      principal={mandate?.principal ?? identity?.name ?? 'Operator'}
      principalSub={`Level ${level} · ${role}`}
      level={level}
      hubs={hubs}
      center={rail.center}
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}
