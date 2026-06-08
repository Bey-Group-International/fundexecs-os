import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNotifications } from '@/lib/queries/notifications';

/* ============================================================================
 * GET /api/notifications — recent notifications + unread count for the top-nav
 * bell dropdown. Session-scoped (RLS); returns an empty set when signed out.
 * ========================================================================= */

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], unreadCount: 0 });

  const all = await getNotifications(user.id);
  return NextResponse.json({
    items: all.slice(0, 8),
    unreadCount: all.filter((n) => !n.read).length
  });
}
