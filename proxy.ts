import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_OPTIONS,
  referralCodeFromJoinPath,
} from "@/lib/referral-link";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  // Opening an invite link is the moment attribution is earned, so capture the
  // code here rather than waiting for a click: a recipient who reads /join/CODE
  // and signs up by some other route would otherwise cost their referrer the
  // reward and themselves the welcome bonus. Middleware because the page is a
  // Server Component, which cannot write a cookie.
  const code = referralCodeFromJoinPath(request.nextUrl.pathname);
  if (code) response.cookies.set(REFERRAL_COOKIE, code, REFERRAL_COOKIE_OPTIONS);

  return response;
}

export const config = {
  // Run on everything except static assets and image optimization. The
  // segmenter files under /mediapipe are static assets too: left in, each of
  // their three requests paid a session refresh to Supabase Auth, and a refresh
  // that rotated the cookie put a Set-Cookie on a 12MB response a shared cache
  // would otherwise have held.
  matcher: [
    "/((?!_next/static|_next/image|mediapipe/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
