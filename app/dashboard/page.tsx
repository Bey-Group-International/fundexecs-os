import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Legacy route. The authenticated home is the Command Center — redirect there
 * (or to login if unauthenticated) so old `/dashboard` links never dead-end on
 * a stale stub.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  redirect(user ? '/command-center' : '/login');
}
