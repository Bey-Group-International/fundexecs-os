import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Post-auth consumer for beta link claims.
 * Called after the user signs in via Google or email magic link.
 * 
 * Flow:
 * 1. User signs in → auth session is set in cookies
 * 2. Browser redirects to /beta/claim/complete?token=...
 * 3. Server calls claim_beta_link RPC with token + user_id + email
 * 4. If success: redirect to /onboarding
 * 5. If error: redirect back to /beta/claim?token=... with error reason
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(
      `${origin}/beta/claim?error=${encodeURIComponent('Missing token.')}`
    );
  }

  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.user) {
    // User is not signed in; bounce back to claim page.
    return NextResponse.redirect(`${origin}/beta/claim?token=${encodeURIComponent(token)}`);
  }

  const userId = session.user.id;
  const email = session.user.email || '';

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('claim_beta_link', {
      _token: token,
      _user_id: userId,
      _email: email
    });

    if (error || !data || !data[0]?.ok) {
      const reason = data?.[0]?.error_reason || error?.message || 'Could not claim link.';
      return NextResponse.redirect(
        `${origin}/beta/claim?token=${encodeURIComponent(token)}&error=${encodeURIComponent(reason)}`
      );
    }

    // Success: redirect to onboarding.
    return NextResponse.redirect(`${origin}/onboarding`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.redirect(
      `${origin}/beta/claim?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`
    );
  }
}
