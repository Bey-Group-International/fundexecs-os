import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { InboxList } from '@/components/inbox/InboxList';
import { getInboxData, getInboxDealOptions } from '@/lib/queries/inbox';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Inbox',
  description:
    'Every conversation — email, Slack, calls — routed onto the deal it belongs to, with Earn drafting the next reply for you to approve.'
};

/** The Relationship Inbox over the RLS-scoped `inbox_items` table (P1). */
export default async function InboxPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [{ pending, actioned, countsByChannel }, dealOptions] = await Promise.all([
    getInboxData(org.orgId),
    getInboxDealOptions(org.orgId)
  ]);

  return (
    <div className="fx-rise mx-auto max-w-[760px]">
      <InboxList
        items={[...pending, ...actioned]}
        countsByChannel={countsByChannel}
        dealOptions={dealOptions}
      />
    </div>
  );
}
