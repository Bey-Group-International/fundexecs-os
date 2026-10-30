import { NextResponse } from "next/server";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

const MESSAGE = "Your sign-up wasn't finished, so you've been signed out. Start again below.";

// Ends a half-finished signup: a session that authenticated but never created
// an organization. GET is the redirect target for server pages; POST is the
// beacon the onboarding wizard fires when the tab is closed.
//
// It only ever signs out a session with NO organization. A fully onboarded
// operator hitting this URL (or a forged cross-site request) is sent to their
// workspace untouched.
async function reset(): Promise<"signed-out" | "has-org"> {
  if (!hasSupabaseServerEnv()) return "signed-out";
  const ctx = await getSessionContext();
  if (!ctx) return "signed-out";
  if (ctx.orgId) return "has-org";
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  return "signed-out";
}

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  if ((await reset()) === "has-org") return NextResponse.redirect(`${origin}/workspace`);
  return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent(MESSAGE)}`);
}

export async function POST() {
  await reset();
  return new NextResponse(null, { status: 204 });
}
