import { NextResponse, type NextRequest } from 'next/server';
import { REFERRAL_COOKIE } from '@/lib/queries/referral-capture';

/** url-safe base64 token, bounded so absurd input is ignored rather than stored. */
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Public referral capture — `/ref/<code>`.
 *
 * Drops a short-lived, httpOnly cookie naming the referrer's code and sends the
 * visitor into the sign-up funnel. The auth callbacks (`/auth/callback`,
 * `/auth/confirm`) read the cookie after the session is established and record
 * the referral first-touch via `record_referral`. No DB work happens here — this
 * stays tiny so a shared link is cheap and safe to hit.
 *
 * (Lives at `/ref/` rather than `/r/` — that path is the public raise page.)
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { origin } = new URL(request.url);
  const { code } = await ctx.params;

  const response = NextResponse.redirect(`${origin}/login?next=%2Fonboarding`);

  // Only persist a sane-looking code; ignore everything else (the redirect still
  // happens so the link never dead-ends).
  if (code && CODE_RE.test(code)) {
    response.cookies.set(REFERRAL_COOKIE, code, {
      path: '/',
      maxAge: 1800,
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://')
    });
  }

  return response;
}
