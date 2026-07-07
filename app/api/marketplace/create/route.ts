import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createListing } from "@/app/(app)/marketplace/actions";

/**
 * Create a marketplace listing from the in-world office "list something" overlay.
 * Thin auth-gated wrapper over the existing createListing server action so the
 * Phaser-hosted client (deep in a client-only tree) can publish without
 * navigating to /marketplace. Accepts JSON, rebuilds the FormData the action
 * expects, and applies the same governance/stake gate as the full-page form.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  // Rebuild the FormData shape createListing reads. Only string/scalar fields
  // are forwarded; is_public is a checkbox ("on" when set) in the action.
  const form = new FormData();
  const put = (key: string, value: unknown) => {
    if (value == null) return;
    const s = String(value).trim();
    if (s) form.set(key, s);
  };
  put("title", title);
  put("listing_type", body.listing_type);
  put("summary", body.summary);
  put("amount", body.amount);
  put("status", body.status);
  put("deal_id", body.deal_id);
  put("target_irr", body.target_irr);
  put("hold_period_years", body.hold_period_years);
  put("geography", body.geography);
  put("asset_class", body.asset_class);
  put("teaser_url", body.teaser_url);
  if (body.is_public === true || body.is_public === "on") form.set("is_public", "on");

  const result = await createListing(form);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
