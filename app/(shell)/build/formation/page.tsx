import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FormationFlow } from '@/components/formation/FormationFlow';
import { mandateCfg, type InvestorGroup } from '@/lib/onboarding/mandate';
import { getFormationState } from '@/lib/queries/formation';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Fund Formation',
  description:
    'Form your fund the copiloted way — story, entity, LPA, PPM, subscription, Reg D, and banking, one step at a time. You decide; Earn drafts and explains.'
};

/**
 * Formation — the Build hub's copiloted, story-first fund-formation
 * walkthrough from the prototype. The operator's working document and step
 * completions persist to `fund_formations` / `formation_steps` (org-scoped
 * RLS), so the flow survives reloads. Regulated surface: "filing" stays
 * illustrative until counsel signs off — nothing leaves the platform.
 */
export default async function FormationPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, formation] = await Promise.all([
    getMandate(org.orgId),
    getFormationState(org.orgId)
  ]);

  const firm = mandate?.firm ?? 'your fund';
  const cfg = mandateCfg((mandate?.investor_group as InvestorGroup) ?? 'fund');
  const sizeLabel = cfg.sizes.find((s) => s.id === mandate?.size)?.label ?? '$500M';

  // Personalize the untouched entity-name defaults to the mandate's firm
  // (the prototype seeds "<firm> GP, LLC" / "<firm> Management, LLC").
  const data = { ...formation.data };
  if (data.gp === 'GP, LLC') data.gp = `${firm} GP, LLC`;
  if (data.mgmtco === 'Management, LLC') data.mgmtco = `${firm} Management, LLC`;

  return (
    <div className="fx-rise">
      <FormationFlow
        firm={firm}
        sizeLabel={sizeLabel}
        initialData={data}
        initialCompleted={formation.completedIds}
      />
    </div>
  );
}
