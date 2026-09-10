import { type NextRequest, NextResponse } from "next/server";

// The cookie-setting step of the referral flow: /join?ref=CODE
//
// Two things arrive here. Invite links shared before /join/[code] existed, which
// are bounced on to that page; and the invite page's own calls to action, which
// pass ?next= to say where the recipient was headed. Either way the code lands
// in a 30-day httpOnly cookie, read later by createOrganization() during
// onboarding so the referral is claimed without anyone retyping a code.
//
// Setting a cookie is why this is a route handler and not the page: a Server
// Component can't write one.

// Where a recipient may be sent from here. An allowlist, because `next` is
// attacker-controllable in a link anyone can craft and forward — an open
// redirect off this route would be handed out under our own domain.
const NEXT_ALLOWED = new Set(["/request-access", "/login"]);

export async function GET(req: NextRequest) {
  const ref = (req.nextUrl.searchParams.get("ref") ?? "").trim().toUpperCase();
  const next = req.nextUrl.searchParams.get("next") ?? "";

  // No code at all: nothing to store, and no invite page to show.
  if (!ref) return NextResponse.redirect(new URL("/login", req.url));

  const dest = NEXT_ALLOWED.has(next) ? next : `/join/${encodeURIComponent(ref)}`;
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.set("referral_code", ref, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: "lax",
  });
  return res;
}
