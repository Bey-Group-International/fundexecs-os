import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ClosingsFlow } from '@/components/execute/ClosingsFlow';
import { getClosingsData } from '@/lib/queries/closings';
import { getActiveOrg } from '@/lib/queries/org';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Closings',
  description:
    'Commitment to close — every closing is a step-gated signature room. Each step executes in order on your approval, and the close lands on your record.'
};

/**
 * Closings — the Execute hub's Commitment-to-Close tracker over the Wave-2
 * `closings` / `closing_steps` tables: open a signature room from a committed
 * deal or LP, then execute the sequence one approved step at a time. The step
 * gate is enforced server-side, and the final step closes the room and feeds
 * the flywheel (`recordLoopClose`).
 */
export default async function ExecuteClosingsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const [data, { data: orgRow }] = await Promise.all([
    getClosingsData(org.orgId),
    supabase.from('organizations').select('name').eq('id', org.orgId).maybeSingle()
  ]);

  return (
    <ClosingsFlow
      closings={data.closings}
      candidates={data.candidates}
      firm={orgRow?.name ?? null}
    />
  );
}
