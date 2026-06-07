import { redirect } from 'next/navigation';

/**
 * The Action Queue (prioritized do-next list) is served today by the
 * Notifications surface, which already unifies signals into one feed. Route
 * the rail's "Action Queue" entry to `/notifications` instead of a placeholder.
 */
export default function ActionQueuePage() {
  redirect('/notifications');
}
