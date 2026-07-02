import { type NextRequest, NextResponse } from "next/server";

// Landing page for affiliate referral links: /join?ref=CODE
// Stores the code in a 30-day httpOnly cookie then redirects to login.
// The cookie is read by createOrganization() in onboarding to auto-claim the
// referral without requiring the new user to manually enter the code.
export async function GET(req: NextRequest) {
  const ref = (req.nextUrl.searchParams.get("ref") ?? "").trim().toUpperCase();
  const dest = new URL("/login", req.url);
  const res = NextResponse.redirect(dest);
  if (ref) {
    res.cookies.set("referral_code", ref, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "lax",
    });
  }
  return res;
}
