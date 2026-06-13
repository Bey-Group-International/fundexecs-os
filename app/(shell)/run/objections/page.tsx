import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ObjectionsFlow } from '@/components/run/ObjectionsFlow';
import { getObjectionsData } from '@/lib/queries/objections';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Objection Handling',
  description:
    "Eleanor's objection desk — log every LP pushback, let Earn draft an institutional rebuttal, and drive each concern to resolved."
};

/** Objection handling — log LP objections and let Earn draft the rebuttals. */
export default async function RunObjectionsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getObjectionsData(org.orgId);

  return (
    <div className="fx-rise">
      <ObjectionsFlow data={data} />
    </div>
  );
}
