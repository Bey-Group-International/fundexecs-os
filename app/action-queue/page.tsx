import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Action Queue' },
  description: 'Your prioritized do-next list — every signal unified into one feed.'
};

/**
 * The Action Queue (prioritized do-next list) is served today by the
 * Notifications surface, which already unifies signals into one feed. Route
 * the rail's "Action Queue" entry to `/notifications` instead of a placeholder.
 */
export default function ActionQueuePage() {
  redirect('/notifications');
}
