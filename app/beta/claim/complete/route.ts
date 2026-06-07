import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Post-auth consumer for beta link claims. Reached after the user signs in via
 * Google or the email magic link.
 *
 * 1. Session is set in cookies → 2. browser lands here with ?token=... →
 * 3. record the claim atomically via claim_beta_link (service role) →
 * 4. success → /onboarding; failure → back to /beta/claim with a safe reason.
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
    // Not signed in yet — bounce back to the claim page for this link.
    return NextResponse.redirect(`${origin}/beta/claim?token=${encodeURIComponent(token)}`);
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('claim_beta_link', {
      _token: token,
      _user_id: session.user.id,
      _email: session.user.email ?? ''
    });

    if (error || !data || !data[0]?.ok) {
      // error_reason values are curated, user-safe strings from the RPC.
      const reason = data?.[0]?.error_reason || 'Could not claim this link.';
      return NextResponse.redirect(
        `${origin}/beta/claim?token=${encodeURIComponent(token)}&error=${encodeURIComponent(reason)}`
      );
    }

    return NextResponse.redirect(`${origin}/onboarding`);
  } catch (err) {
    // Log details server-side; never leak raw exception text to the client.
    console.error('beta claim completion failed', err);
    return NextResponse.redirect(
      `${origin}/beta/claim?token=${encodeURIComponent(token)}&error=${encodeURIComponent('An unexpected error occurred. Please try again.')}`
    );
  }
}
