import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { expressInterestInListing } from "@/app/(app)/marketplace/actions";

/**
 * Express interest in a public marketplace listing from the in-world office
 * detail card. Thin auth-gated wrapper over the existing server action so the
 * Phaser-hosted client (deep in a client-only tree) can record interest without
 * navigating to /marketplace.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { listingId?: string; listingTitle?: string };
  if (!body.listingId || typeof body.listingId !== "string") {
    return NextResponse.json({ error: "listingId required" }, { status: 400 });
  }

  const result = await expressInterestInListing(body.listingId, body.listingTitle ?? "this listing");
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
