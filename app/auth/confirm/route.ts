import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordPeerReferral } from '@/lib/queries/referral-capture';
import { REFERRAL_COOKIE } from '@/app/r/[code]/route';

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
  const inviteId = searchParams.get('invite_id');
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
  const userId = data.user?.id;
  if (email && userId) {
    try {
      const admin = createAdminClient();
      await admin.rpc('accept_beta_invite', {
        _email: email.toLowerCase(),
        _user_id: userId,
        ...(inviteId ? { _invite_id: inviteId } : {})
      });

      // Record the referral (best-effort, first-touch): the inviting admin earns
      // a commission on this user's own-org purchases. record_referral resolves
      // their own org, is idempotent, and no-ops for teammates (same org).
      const inviteQuery = admin
        .from('beta_invites')
        .select('id, invited_by, org_id')
        .eq('email', email.toLowerCase());
      const { data: invite } = await (
        inviteId
          ? inviteQuery.eq('id', inviteId)
          : inviteQuery.order('last_sent_at', { ascending: false })
      )
        .limit(1)
        .maybeSingle();
      if (invite?.invited_by) {
        await admin.rpc('record_referral', {
          _referred_user_id: userId,
          _referrer_user_id: invite.invited_by,
          _referrer_org_id: invite.org_id,
          _source: 'beta_invite',
          _source_id: invite.id
        });
      }
    } catch {
      // Acceptance tracking is best-effort — never block the sign-in.
    }
  }

  // Capture a peer referral (best-effort) from the /r/<code> cookie. First-touch
  // and idempotent, so a beta-invite user who also carries a peer cookie keeps
  // their invite attribution (record_referral no-ops on a repeat).
  const refCode = request.cookies.get(REFERRAL_COOKIE)?.value;
  if (refCode && userId) {
    await recordPeerReferral(userId, refCode);
  }

  const response = NextResponse.redirect(`${origin}${next}`);
  response.cookies.delete(REFERRAL_COOKIE);
  return response;
}
