import { redirect } from 'next/navigation';
import { getLifecycleRail } from '@/lib/hubs';
import { hubContent, hubMeta, type HubId } from '@/lib/hubs/lifecycle';
import type { InvestorGroup } from '@/lib/onboarding/mandate';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';
import { EARN_HUB_NOTES, HubLanding } from './HubLanding';

/**
 * Server loader shared by the four hub routes: resolves the org, the mandate's
 * member type, and the request-cached lifecycle rail, then renders the hub's
 * role-aware landing. Keeps each `app/(shell)/<hub>/page.tsx` a thin shim so
 * the hubs can never drift apart.
 */
export async function HubPage({ id }: { id: HubId }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, rail] = await Promise.all([getMandate(org.orgId), getLifecycleRail(org.orgId)]);
  const group = (mandate?.investor_group as InvestorGroup) ?? 'fund';

  return (
    <HubLanding
      meta={hubMeta(id)}
      content={hubContent(group, id)}
      pct={rail.pct[id]}
      isCenter={rail.center === id}
      earnNote={EARN_HUB_NOTES[id]}
    />
  );
}
