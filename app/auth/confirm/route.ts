import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Verifies an email magic link minted by the beta-invite flow (and any other
 * token-hash link). Uses `verifyOtp({ token_hash, type })`, which writes the
 * session into server-readable cookies without a PKCE code-verifier — so a
 * link opened cold from an email (no browser-side verifier) still signs in.
 *
 * On success it marks any pending beta invite for the verified email as
 * accepted (service role, so it can flip a row the brand-new user does not yet
 * own under RLS), then routes the user on (onboarding for fresh beta users).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  // Only allow same-origin relative paths to avoid open-redirects.
  const requestedNext = searchParams.get('next');
  const next =
    requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/command-center';

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Invalid or expired invite link.')}`
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  const email = data.user?.email;
  if (email) {
    try {
      const admin = createAdminClient();
      await admin
        .from('beta_invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('email', email.toLowerCase())
        .eq('status', 'pending');
    } catch {
      // Acceptance tracking is best-effort — never block the sign-in.
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
