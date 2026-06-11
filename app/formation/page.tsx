import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { createClient } from '@/lib/supabase/server';
import { mandateCfg, type InvestorGroup } from '@/lib/onboarding/mandate';
import { FormationFlow } from '@/components/formation/FormationFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Fund Formation',
  description:
    'Form your fund the copiloted way — story, entity, LPA, PPM, subscription, Reg D, and banking, one step at a time. You decide; Earn drafts and explains.'
};

/**
 * Formation — the copiloted, story-first fund-formation walkthrough ported from
 * the prototype. Regulated surface: the flow is **illustrative** (client-side,
 * no filings or DB writes) until the formation schema lands and counsel signs
 * off. Identity (firm name + target raise) is read from the live org/mandate.
 */
export default async function FormationPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell title="Fund Formation" subtitle="Build" redirectFrom="/formation">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No workspace yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Your workspace is being set up. Refresh in a moment to start forming your fund.
            </p>
          </Card>
        </div>
      </AuthedShell>
    );
  }

  // Best-effort: firm name from the live profile, target-raise label from the
  // org's mandate (the flow is illustrative, so sensible defaults are fine).
  let sizeLabel = '$500M';
  let firm = 'your fund';
  try {
    const supabase = await createClient();
    const [profile, { data: mandate }] = await Promise.all([
      getFundProfile(org.orgId).catch(() => null),
      supabase.from('mandates').select('investor_group, size').eq('org_id', org.orgId).maybeSingle()
    ]);
    if (profile?.fundName) firm = profile.fundName;
    if (mandate?.size) {
      const cfg = mandateCfg((mandate.investor_group as InvestorGroup) ?? 'fund');
      sizeLabel = cfg.sizes.find((s) => s.id === mandate.size)?.label ?? sizeLabel;
    }
  } catch {
    // keep defaults
  }

  return (
    <AuthedShell title="Fund Formation" subtitle="Build" redirectFrom="/formation">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <FormationFlow firm={firm} sizeLabel={sizeLabel} />
      </div>
    </AuthedShell>
  );
}
