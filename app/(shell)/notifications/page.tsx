import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NotificationsList } from '@/components/notifications/NotificationsList';
import { getNotifications } from '@/lib/queries/notifications';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Notifications',
  description:
    'What the team surfaced for you — diligence verdicts, intro replies, deliverables coming due — each linking straight to the surface it lives on.'
};

/** The notifications inbox over the real `notifications` table (RLS-scoped). */
export default async function NotificationsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const items = await getNotifications(org.userId);

  return (
    <div className="fx-rise mx-auto max-w-[760px]">
      <NotificationsList items={items} />
    </div>
  );
}
