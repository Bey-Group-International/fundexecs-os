import { NextResponse } from "next/server";
import {
  createServerClient,
  createServiceClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

const MESSAGE = "Your sign-up wasn't finished, so you've been signed out. Start again below.";

type ResetOutcome = "signed-out" | "keep" | "failed";

// Ends a half-finished signup: a session that authenticated but never created
// an organization. GET is the redirect target for server pages; POST is the
// beacon the onboarding wizard fires when the tab is closed.
//
// It only signs out a session that is CONFIRMED to have no organization. If the
// membership lookup errors, organization status is unknown and the session is
// kept, so a transient database failure can never log out an onboarded operator.
// Only the current session is ended (`local`), not the user's other devices.
async function reset(): Promise<ResetOutcome> {
  if (!hasSupabaseServerEnv()) return "signed-out";

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return "signed-out";

  const { data: membership, error: membershipError } = await createServiceClient()
    .from("organization_members")
    .select("organization_id")
    .eq("principal_id", user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError || membership) return "keep";

  const { error } = await supabase.auth.signOut({ scope: "local" });
  return error ? "failed" : "signed-out";
}

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const outcome = await reset();
  if (outcome === "keep") return NextResponse.redirect(`${origin}/workspace`);
  // Redirecting to /login here would bounce a still-signed-in user straight
  // back to this route.
  if (outcome === "failed") {
    return new NextResponse("Could not sign out. Please try again.", { status: 500 });
  }
  return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent(MESSAGE)}`);
}

export async function POST() {
  const outcome = await reset();
  return new NextResponse(null, { status: outcome === "failed" ? 500 : 204 });
}
