import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CapitalMapFlow } from '@/components/source/CapitalMapFlow';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { getLpPipeline } from '@/lib/queries/lp-pipeline';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';
import { SRC_NOUN, SRC_TITLE, sourceGroupFor } from '@/lib/source/vocab';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'LP Capital Map',
  description:
    'Your raise on one map — every LP fit-scored and staged from target to committed. Earn drafts each move; nothing reaches an LP until you approve.'
};

/** Mandate size id → raise target in dollars (mirrors the size choices). */
const SIZE_TARGET: Record<string, number> = {
  '5': 5_000_000,
  '25': 25_000_000,
  '50': 50_000_000,
  '100': 100_000_000,
  '250': 250_000_000,
  '500': 500_000_000,
  '1000': 1_000_000_000
};

/**
 * LP Capital Map — the Source hub's first deep module, entirely on real data:
 * LPs are `capital_providers` rows through `getLpPipeline` (the canonical
 * stage board), the thermometer reads real committed/soft-circled value
 * against the org's raise target (the fund profile's stated target, falling
 * back to the mandate's declared size), and every "with Earn" move runs the
 * approve loop — `advanceLpStage` executes only on the operator's approval
 * and moves exactly one stage.
 */
export default async function CapitalMapPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const [mandate, pipeline, profile, { data: orgRow }] = await Promise.all([
    getMandate(org.orgId),
    getLpPipeline(org.orgId),
    getFundProfile(org.orgId),
    supabase.from('organizations').select('type').eq('id', org.orgId).maybeSingle()
  ]);

  const group = sourceGroupFor(orgRow?.type);
  const lps = pipeline.columns.flatMap((c) => c.lps);
  const profileTarget = profile.targetRaise ?? 0;
  const target = profileTarget > 0 ? profileTarget : (SIZE_TARGET[mandate?.size ?? ''] ?? 0);

  return (
    <div className="fx-rise mx-auto max-w-[980px]">
      <CapitalMapFlow
        lps={lps}
        target={target}
        committedValue={pipeline.committedValue}
        softCircledValue={pipeline.softCircledValue}
        title={SRC_TITLE[group]}
        noun={SRC_NOUN[group]}
      />
    </div>
  );
}
