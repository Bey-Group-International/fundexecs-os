import { type NextRequest, NextResponse } from "next/server";
import { fulfillCheckout } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Stripe Checkout success_url lands here with ?session_id=…. We verify the
// session was paid and apply its effect (idempotently), then bounce the operator
// back to the right page with a status flag. This is the primary fulfillment
// path — no webhook secret required.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const origin = req.nextUrl.origin;
  if (!sessionId) return NextResponse.redirect(new URL("/wallet", origin));

  try {
    const res = await fulfillCheckout(sessionId);
    const dest = res.kind === "gift" ? "/gift" : "/wallet";
    const status = res.ok ? "success" : "error";
    return NextResponse.redirect(new URL(`${dest}?checkout=${status}`, origin));
  } catch {
    return NextResponse.redirect(new URL("/wallet?checkout=error", origin));
  }
}
