'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

export type NotificationActionResult = { ok: true } | { ok: false; error: string };

/**
 * Revalidate every authed surface so the AppShell layout's bell-badge
 * counter (computed server-side from `getIdentity()`'s unread fetch) is
 * recomputed on next render. Without this, mark-as-read writes the row
 * to the DB but the badge stays at its stale count until the user
 * navigates to a hard route boundary.
 */
function revalidateShell() {
  revalidatePath('/', 'layout');
}

/**
 * Mark a single notification as read. Idempotent — re-marking a row that
 * already has `read_at` set is a no-op.
 */
export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  if (!id) return { ok: false, error: 'Missing notification id.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) return { ok: false, error: error.message };
  revalidateShell();
  return { ok: true };
}

/**
 * Soft-dismiss a notification — stamp `archived_at` so it drops out of the
 * active inbox view but stays available for audit / history.
 */
export async function dismissNotification(id: string): Promise<NotificationActionResult> {
  if (!id) return { ok: false, error: 'Missing notification id.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('notifications')
    .update({
      archived_at: new Date().toISOString(),
      read_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidateShell();
  return { ok: true };
}

/**
 * Mark every unread notification in the active org as read. Server runs
 * the update under the user's session so RLS still gates the row set.
 */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', org.userId)
    .is('read_at', null);
  if (error) return { ok: false, error: error.message };
  revalidateShell();
  return { ok: true };
}
