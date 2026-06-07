import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMemberType } from '@/lib/member-types';
import { BETA_APPLICATION_COOKIE, type BetaApplication } from '@/lib/beta/welcome';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';

/**
 * Seed the brand-new member's profile from the pre-auth welcome "application"
 * so onboarding resumes from it instead of asking again. Sets the member type
 * (which makes OnboardingView skip the identity step) and stashes the captured
 * name + goal into the Proof of Truth `draft`. Best-effort: a failure here must
 * never block getting the user into the app.
 */
async function seedFromApplication(
  admin: SupabaseClient<Database>,
  userId: string,
  app: BetaApplication
): Promise<void> {
  const name = typeof app.name === 'string' ? app.name.trim().slice(0, 120) : '';
  const goal = typeof app.goal === 'string' ? app.goal.trim().slice(0, 400) : '';
  const memberType = isMemberType(app.memberType) ? app.memberType : null;

  if (name) {
    await admin.from('profiles').update({ full_name: name }).eq('id', userId);
  }
  if (memberType) {
    await admin.from('profiles').update({ member_type: memberType }).eq('id', userId);
  }

  const draft: Json = {
    source: 'beta_welcome',
    ...(name ? { name } : {}),
    ...(goal ? { goal } : {})
  };
  await admin
    .from('member_profiles')
    .upsert(
      { user_id: userId, ...(name ? { display_name: name } : {}), draft },
      { onConflict: 'user_id' }
    );
}

/**
 * Post-auth consumer for beta link claims. Reached after the user signs in via
 * Google or the email magic link.
 *
 * 1. Session is set in cookies → 2. browser lands here with ?token=... →
 * 3. record the claim atomically via claim_beta_link (service role) →
 * 4. seed the profile from the welcome application →
 * 5. success → /onboarding; failure → back to /beta/claim with a safe reason.
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

    // Carry the pre-auth welcome answers into the new profile (best-effort).
    const rawApp = request.cookies.get(BETA_APPLICATION_COOKIE)?.value;
    if (rawApp) {
      try {
        const app = JSON.parse(decodeURIComponent(rawApp)) as BetaApplication;
        await seedFromApplication(admin, session.user.id, app);
      } catch {
        // Malformed cookie — ignore and continue into onboarding.
      }
    }

    const response = NextResponse.redirect(`${origin}/onboarding`);
    response.cookies.delete(BETA_APPLICATION_COOKIE);
    return response;
  } catch (err) {
    // Log details server-side; never leak raw exception text to the client.
    console.error('beta claim completion failed', err);
    return NextResponse.redirect(
      `${origin}/beta/claim?token=${encodeURIComponent(token)}&error=${encodeURIComponent('An unexpected error occurred. Please try again.')}`
    );
  }
}
