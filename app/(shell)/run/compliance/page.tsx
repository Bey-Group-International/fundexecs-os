import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ComplianceFlow } from '@/components/run/ComplianceFlow';
import { getComplianceItems } from '@/lib/queries/run-ops';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Compliance',
  description:
    "Adrian's posture board — the compliance baseline every emerging manager owes, severity-ranked and worked to resolution with counsel in the loop."
};

/** Compliance — Adrian's posture board over the Wave-3 compliance_items table. */
export default async function RunCompliancePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const items = await getComplianceItems(org.orgId);
  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <ComplianceFlow items={items} />
    </div>
  );
}
