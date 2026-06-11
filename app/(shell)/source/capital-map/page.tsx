import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CapitalMapFlow } from '@/components/source/CapitalMapFlow';
import { getLpPipeline } from '@/lib/queries/lp-pipeline';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';

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
 * against the mandate's target, and every "with Earn" move runs the approve
 * loop — `updateLpStage` executes only on the operator's approval.
 */
export default async function CapitalMapPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, pipeline] = await Promise.all([getMandate(org.orgId), getLpPipeline(org.orgId)]);

  const lps = pipeline.columns.flatMap((c) => c.lps);
  const target = SIZE_TARGET[mandate?.size ?? ''] ?? 0;

  return (
    <div className="fx-rise mx-auto max-w-[980px]">
      <CapitalMapFlow
        lps={lps}
        target={target}
        committedValue={pipeline.committedValue}
        softCircledValue={pipeline.softCircledValue}
      />
    </div>
  );
}
