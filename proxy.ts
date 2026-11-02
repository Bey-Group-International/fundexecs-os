import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_OPTIONS,
  referralCodeFromJoinPath,
} from "@/lib/referral-link";

// CommonJS so that next.config.mjs and the tests can load it too.
const { isLpPath, lpNonceReportOnlyPolicy } = require("./lib/security-headers.cjs") as {
  isLpPath: (pathname: string) => boolean;
  lpNonceReportOnlyPolicy: (nonce: string, o?: { dev?: boolean }) => string;
};

/** A fresh, unguessable value for one request (base64 of a UUID, which is a valid CSP nonce). */
function newNonce(): string {
  return btoa(crypto.randomUUID());
}

export async function proxy(request: NextRequest) {
  // The investor pages are sent a nonce-based script policy REPORT-ONLY (SOC 2 gap G-4): the
  // enforced policy is unchanged, and the browser reports what this one would have blocked. The
  // request carries it too, which is how Next.js learns the nonce to put on its own scripts.
  let policy: string | null = null;
  let forwarded = request;
  if (isLpPath(request.nextUrl.pathname)) {
    policy = lpNonceReportOnlyPolicy(newNonce(), { dev: process.env.NODE_ENV !== "production" });
    const headers = new Headers(request.headers);
    headers.set("Content-Security-Policy-Report-Only", policy);
    forwarded = new NextRequest(request, { headers });
  }
  const response = await updateSession(forwarded);
  if (policy) response.headers.set("Content-Security-Policy-Report-Only", policy);

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
    "/((?!_next/static|_next/image|mediapipe/|api/csp-report|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
