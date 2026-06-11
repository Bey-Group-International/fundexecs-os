import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { IrFlow } from '@/components/run/IrFlow';
import { getIrItems } from '@/lib/queries/run-ops';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'IR & Reporting',
  description:
    "Eleanor's LP cadence — the deliverables investors expect, dated and driven to sent on your approval."
};

/** IR & reporting — Eleanor's cadence over the Wave-3 ir_items table. */
export default async function RunIrPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const items = await getIrItems(org.orgId);
  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <IrFlow items={items} />
    </div>
  );
}
